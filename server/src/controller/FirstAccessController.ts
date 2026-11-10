import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { AuthAttemptKind } from "@prisma/client";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { writeAudit } from "../helper/audit";
import { accessEnded } from "../helper/access-period";
import { isValidCpf, normalizeCpf } from "../helper/cpf";
import { parseBirthDate, sameBirthDate } from "../helper/birth-date";
import {
  ACCOUNT_MAX_FAILURES,
  IP_MAX_FAILURES,
  IP_WINDOW_MS,
  canonicalRegistration,
  clearFailures,
  clientIp,
  firstAccessKey,
  ipKey,
  lockIfAtLimit,
  lockedUntil,
  pseudonym,
  recordAttempt,
  releaseAttempt,
  reserveAttempt,
} from "../helper/auth-attempts";

/**
 * Primeiro acesso por conferência de dados. [C1-7]
 *
 * A planilha não gera mais senha provisória: a conta nasce "aguardando
 * primeiro acesso", e a própria pessoa cria a senha depois de informar
 * matrícula, CPF e data de nascimento. Em duas etapas:
 *
 * 1. `POST /api/auth/primeiro-acesso` confere os três dados na ficha (da
 *    MESMA pessoa) e as condições da conta, e emite uma ficha de ativação
 *    opaca, de uso único, que vale 10 minutos.
 * 2. `POST /api/auth/primeiro-acesso/senha` cria a senha com a ficha,
 *    conferindo tudo de novo.
 *
 * Qualquer erro dá a MESMA resposta: não diz qual dado errou nem se a
 * matrícula existe. Nenhum CPF, nascimento ou senha digitado vai para log,
 * trilha ou registro de tentativa.
 */

export const FIRST_ACCESS_DENIED =
  "Os dados não conferem ou o primeiro acesso não está liberado. Procure o RH ou o seu gerente.";

const TOKEN_TTL_MS = 10 * 60_000;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function negar(res: Response) {
  res.status(400).json({ message: FIRST_ACCESS_DENIED, code: "FIRST_ACCESS_DENIED" });
}

/** A conta está em condição de ativar sozinha agora? */
function podeAtivar(
  user: {
    active: boolean;
    activatedAt: Date | null;
    firstAccessEligible: boolean;
    firstAccessUntil: Date | null;
  },
  agora: Date,
): boolean {
  return (
    user.active &&
    user.activatedAt === null &&
    user.firstAccessEligible &&
    user.firstAccessUntil !== null &&
    user.firstAccessUntil > agora
  );
}

/** A mesma regra de senha da troca de senha. */
function senhaRecusada(senha: unknown, confirmacao: unknown): string | null {
  if (typeof senha !== "string" || senha.length < 8) {
    return "A senha precisa ter pelo menos 8 caracteres.";
  }
  if (senha !== confirmacao) return "As duas senhas não são iguais.";
  if (senha === "123456") return "Escolha outra senha.";
  return null;
}

class FirstAccessController {
  /** Etapa 1: confere matrícula + CPF + nascimento e emite a ficha. */
  async verify(req: Request, res: Response) {
    const { matricula, cpf, nascimento } = req.body as {
      matricula?: unknown;
      cpf?: unknown;
      nascimento?: unknown;
    };
    if (
      typeof matricula !== "string" ||
      !matricula.trim() ||
      typeof cpf !== "string" ||
      !cpf.trim() ||
      typeof nascimento !== "string" ||
      !nascimento.trim()
    ) {
      res.status(400).json({ message: "Informe matrícula, CPF e data de nascimento." });
      return;
    }

    const ip = clientIp(req);
    const chave = firstAccessKey(matricula);
    const chaveDoIp = ipKey(ip);
    const tentativa = {
      kind: AuthAttemptKind.FIRST_ACCESS,
      subject: pseudonym(canonicalRegistration(matricula)),
      ip,
    };

    /*
      A tentativa é RESERVADA antes de consultar a ficha: só as 5 primeiras
      (20 por IP) chegam a conferir, mesmo numa rajada simultânea. Conferir
      antes e contar depois deixava a rajada inteira passar pela trava.
    */
    const [daMatricula, doIp] = await Promise.all([
      reserveAttempt(chave, ACCOUNT_MAX_FAILURES, null),
      reserveAttempt(chaveDoIp, IP_MAX_FAILURES, IP_WINDOW_MS),
    ]);
    if (!daMatricula.ok || !doIp.ok) {
      await recordAttempt({ ...tentativa, userId: null, success: false });
      negar(res);
      return;
    }

    const falhou = async (userId: string | null) => {
      await Promise.all([
        lockIfAtLimit(chave, ACCOUNT_MAX_FAILURES),
        lockIfAtLimit(chaveDoIp, IP_MAX_FAILURES),
      ]);
      await recordAttempt({ ...tentativa, userId, success: false });
      negar(res);
    };

    let nascidoEm: Date | null;
    try {
      nascidoEm = parseBirthDate(nascimento);
    } catch {
      nascidoEm = null;
    }
    const cpfLimpo = normalizeCpf(cpf);
    if (!nascidoEm || !isValidCpf(cpfLimpo)) {
      await falhou(null);
      return;
    }

    /*
      O CPF é único dentro da empresa e a matrícula se repete entre
      empresas: procura-se pelo CPF e confere-se matrícula e nascimento na
      MESMA ficha. Mais de uma ficha conferindo: não há como saber de quem
      é, e o caminho é o RH.
    */
    const fichas = await prisma.employeeProfile.findMany({
      where: { taxId: cpfLimpo, dismissedAt: null, organization: { active: true } },
      select: {
        organizationId: true,
        registration: true,
        birthDate: true,
        user: {
          select: {
            id: true,
            active: true,
            activatedAt: true,
            firstAccessEligible: true,
            firstAccessUntil: true,
            memberships: {
              select: { organizationId: true, suspendedAt: true, accessExpiresAt: true },
            },
          },
        },
      },
    });
    const conferem = fichas.filter(
      (f) =>
        f.registration !== null &&
        canonicalRegistration(f.registration) === canonicalRegistration(matricula) &&
        sameBirthDate(f.birthDate, nascidoEm),
    );
    if (conferem.length !== 1) {
      await falhou(null);
      return;
    }
    const [ficha] = conferem;
    const agora = new Date();
    const vinculo = ficha.user.memberships.find((m) => m.organizationId === ficha.organizationId);
    if (
      !podeAtivar(ficha.user, agora) ||
      !vinculo ||
      vinculo.suspendedAt !== null ||
      accessEnded(vinculo.accessExpiresAt, agora)
    ) {
      await falhou(ficha.user.id);
      return;
    }

    const bruto = randomBytes(32).toString("base64url");
    await prisma.$transaction([
      /* Uma ficha de ativação por vez: a nova revoga as anteriores. */
      prisma.activationToken.updateMany({
        where: { userId: ficha.user.id, usedAt: null, revokedAt: null },
        data: { revokedAt: agora },
      }),
      prisma.activationToken.create({
        data: {
          userId: ficha.user.id,
          organizationId: ficha.organizationId,
          tokenHash: hashToken(bruto),
          expiresAt: new Date(agora.getTime() + TOKEN_TTL_MS),
        },
      }),
    ]);
    await clearFailures(chave);
    await releaseAttempt(chaveDoIp);
    await recordAttempt({ ...tentativa, userId: ficha.user.id, success: true });

    res.setHeader("Cache-Control", "no-store");
    res.json({ token: bruto, expires_in: TOKEN_TTL_MS / 1000 });
  }

  /** Etapa 2: cria a senha com a ficha, conferindo tudo de novo. */
  async setPassword(req: Request, res: Response) {
    const { token, password, password_confirmation } = req.body as {
      token?: unknown;
      password?: unknown;
      password_confirmation?: unknown;
    };
    if (typeof token !== "string" || !token) {
      negar(res);
      return;
    }
    const recusa = senhaRecusada(password, password_confirmation);
    if (recusa) {
      res.status(400).json({ message: recusa, field: "password" });
      return;
    }

    const agora = new Date();
    const ficha = await prisma.activationToken.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        userId: true,
        organizationId: true,
        usedAt: true,
        revokedAt: true,
        expiresAt: true,
        user: {
          select: {
            active: true,
            activatedAt: true,
            firstAccessEligible: true,
            firstAccessUntil: true,
            employeeProfiles: {
              select: { organizationId: true, registration: true },
            },
          },
        },
      },
    });
    if (!ficha || ficha.usedAt || ficha.revokedAt || ficha.expiresAt <= agora) {
      negar(res);
      return;
    }
    const registro = ficha.user.employeeProfiles.find(
      (p) => p.organizationId === ficha.organizationId,
    )?.registration;
    if (
      !podeAtivar(ficha.user, agora) ||
      (registro && (await lockedUntil([firstAccessKey(registro)])))
    ) {
      negar(res);
      return;
    }

    const passwordHash = await bcrypt.hash(password as string, 10);
    const ativou = await prisma.$transaction(async (tx) => {
      /* Uso único: só uma das chamadas ao mesmo tempo marca a ficha. */
      const marcou = await tx.activationToken.updateMany({
        where: { id: ficha.id, usedAt: null, revokedAt: null, expiresAt: { gt: agora } },
        data: { usedAt: agora },
      });
      if (marcou.count !== 1) return false;
      const gravou = await tx.user.updateMany({
        where: {
          id: ficha.userId,
          active: true,
          activatedAt: null,
          firstAccessEligible: true,
          firstAccessUntil: { gt: agora },
        },
        data: {
          passwordHash,
          activatedAt: agora,
          mustChangePassword: false,
          /* Não funciona de novo. */
          firstAccessUntil: null,
        },
      });
      if (gravou.count !== 1) throw new RecusaDeAtivacao();
      await tx.activationToken.updateMany({
        where: { userId: ficha.userId, usedAt: null, revokedAt: null },
        data: { revokedAt: agora },
      });
      return true;
    }).catch((err) => {
      if (err instanceof RecusaDeAtivacao) return false;
      throw err;
    });
    if (!ativou) {
      negar(res);
      return;
    }

    await writeAudit({
      organizationId: ficha.organizationId,
      actorId: ficha.userId,
      action: "user.first_access",
      entityType: "User",
      entityId: ficha.userId,
      context: { ip: clientIp(req) },
    });

    res.json({ ok: true });
  }
}

class RecusaDeAtivacao extends Error {}

export default new FirstAccessController();
