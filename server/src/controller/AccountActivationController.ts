import { Request, Response } from "express";
import { Role } from "@prisma/client";
import prisma from "../model/prisma";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { canAssignOrgRole } from "../helper/invite-access";
import { canWriteModule } from "../helper/module-access";
import {
  FIRST_ACCESS_WINDOW_DAYS,
  accountKey,
  firstAccessKey,
} from "../helper/auth-attempts";
import type { AuthRequest } from "../types/auth";

/**
 * Painel de ativação das contas e as ações sobre ele. [C1-7]
 *
 * Quem vê: Master, Dono, RH e — só lendo — o gerente, cada um na própria
 * empresa (módulo `ativacao`). Quem age: Master, Dono e RH, conferido aqui.
 *
 * Uma situação por pessoa, nesta ordem: Bloqueado · Ativo · Legado não
 * classificado · Sem dados para o primeiro acesso · Prazo vencido ·
 * Aguardando primeiro acesso.
 */

export type ActivationSituation =
  | "BLOCKED"
  | "ACTIVE"
  | "LEGACY_UNCLASSIFIED"
  | "MISSING_DATA"
  | "WINDOW_EXPIRED"
  | "AWAITING";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

/** Master, Dono e RH — os que cuidam de Conta e usuários. [D1] */
function podeAgir(auth: AuthRequest): boolean {
  const a = auth.actor!;
  return (
    canWriteModule(a.permission, "ativacao") &&
    (Boolean(a.isMaster) || a.role === Role.OWNER || a.role === Role.MASTER || a.role === Role.RH)
  );
}

function liberadoAte(): Date {
  return new Date(Date.now() + FIRST_ACCESS_WINDOW_DAYS * 24 * 3600_000);
}

/**
 * A última entrada da CONTA, em qualquer empresa. A conta (senha, marcador
 * de ativação, janela do primeiro acesso) é uma só para todas as empresas:
 * a entrada pela empresa B desmente "nunca entrou" dito pelo RH da A.
 */
async function ultimaEntrada(userId: string): Promise<Date | null> {
  const e = await prisma.auditEvent.findFirst({
    where: { action: "session.signin", entityType: "User", entityId: userId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return e?.createdAt ?? null;
}

/**
 * A conta tem vínculo ativo em outra empresa? Então abrir o primeiro acesso
 * por aqui daria a quem tem os dados desta ficha a senha de uma conta que
 * também é usada lá. O caminho é o reset.
 */
async function temVinculoEmOutraEmpresa(orgId: string, userId: string): Promise<boolean> {
  const agora = new Date();
  const outro = await prisma.membership.findFirst({
    where: {
      userId,
      organizationId: { not: orgId },
      suspendedAt: null,
      OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: agora } }],
      organization: { active: true },
    },
    select: { id: true },
  });
  return Boolean(outro);
}

/** A pessoa desta empresa sobre quem se age, com o que a ação precisa. */
async function alvo(req: Request, res: Response) {
  const auth = req as AuthRequest;
  const orgId = actorOrgId(auth);
  if (!podeAgir(auth)) {
    res.status(403).json({ message: "Só Master, Dono e RH agem sobre o acesso das contas." });
    return null;
  }
  const membership = await prisma.membership.findFirst({
    where: { organizationId: orgId, userId: req.params.userId },
    select: {
      role: true,
      user: {
        select: {
          id: true,
          activatedAt: true,
          firstAccessEligible: true,
          employeeProfiles: {
            where: { organizationId: orgId },
            select: { registration: true },
          },
        },
      },
    },
  });
  if (!membership) {
    res.status(404).json({ message: "Pessoa não encontrada nesta empresa." });
    return null;
  }
  if (!auth.actor!.isMaster && !canAssignOrgRole(auth.actor!, membership.role)) {
    res.status(403).json({ message: "Você só age sobre o acesso de quem está abaixo do seu papel." });
    return null;
  }
  return { orgId, actorId: actorUserId(auth), user: membership.user };
}

/** Abre o primeiro acesso por 30 dias: zera tentativas e revoga fichas. */
async function abrirPrimeiroAcesso(user: {
  id: string;
  employeeProfiles: Array<{ registration: string | null }>;
}) {
  const agora = new Date();
  const chaves = [
    accountKey(user.id),
    ...user.employeeProfiles
      .map((p) => p.registration)
      .filter((r): r is string => Boolean(r))
      .map((r) => firstAccessKey(r)),
  ];
  await prisma.$transaction([
    prisma.activationToken.updateMany({
      where: { userId: user.id, usedAt: null, revokedAt: null },
      data: { revokedAt: agora },
    }),
    prisma.authLockout.deleteMany({ where: { key: { in: chaves } } }),
    prisma.user.update({
      where: { id: user.id },
      data: { firstAccessEligible: true, firstAccessUntil: liberadoAte() },
    }),
  ]);
}

class AccountActivationController {
  /** O painel: a situação de cada pessoa da empresa e os totais por unidade. */
  async list(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const membros = await prisma.membership.findMany({
        where: { organizationId: orgId, role: { not: Role.FISCAL } },
        select: {
          role: true,
          suspendedAt: true,
          user: {
            select: {
              id: true,
              name: true,
              login: true,
              active: true,
              activatedAt: true,
              firstAccessEligible: true,
              firstAccessUntil: true,
              employeeProfiles: {
                where: { organizationId: orgId },
                select: {
                  registration: true,
                  taxId: true,
                  birthDate: true,
                  dismissedAt: true,
                  establishment: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
        orderBy: { user: { name: "asc" } },
      });

      const agora = new Date();
      const chavesPorPessoa = new Map<string, string[]>();
      for (const m of membros) {
        const ficha = m.user.employeeProfiles[0];
        chavesPorPessoa.set(m.user.id, [
          accountKey(m.user.id),
          ...(ficha?.registration ? [firstAccessKey(ficha.registration)] : []),
        ]);
      }
      const bloqueios = await prisma.authLockout.findMany({
        where: { key: { in: [...chavesPorPessoa.values()].flat() }, lockedUntil: { gt: agora } },
        select: { key: true, lockedUntil: true },
      });
      const bloqueioPorChave = new Map(bloqueios.map((b) => [b.key, b.lockedUntil!]));

      /* A última entrada da conta, em qualquer empresa: a conta é uma só. */
      const entradas = await prisma.auditEvent.groupBy({
        by: ["entityId"],
        where: {
          action: "session.signin",
          entityType: "User",
          entityId: { in: membros.map((m) => m.user.id) },
        },
        _max: { createdAt: true },
      });
      const entradaPor = new Map(entradas.map((e) => [e.entityId, e._max.createdAt]));

      const desde = new Date(agora.getTime() - 24 * 3600_000);
      const erros = await prisma.authAttempt.groupBy({
        by: ["userId"],
        where: { userId: { in: membros.map((m) => m.user.id) }, success: false, at: { gte: desde } },
        _count: { _all: true },
      });
      const errosPor = new Map(erros.map((e) => [e.userId, e._count._all]));

      const people = membros
        .filter((m) => !m.user.employeeProfiles[0]?.dismissedAt)
        .map((m) => {
          const u = m.user;
          const ficha = u.employeeProfiles[0];
          const faltam = [
            ...(ficha?.registration ? [] : ["matrícula"]),
            ...(ficha?.taxId ? [] : ["CPF"]),
            ...(ficha?.birthDate ? [] : ["nascimento"]),
          ];
          const ate = (chavesPorPessoa.get(u.id) ?? [])
            .map((k) => bloqueioPorChave.get(k))
            .filter((d): d is Date => Boolean(d))
            .sort((a, b) => b.getTime() - a.getTime())[0];
          let situation: ActivationSituation;
          if (ate) situation = "BLOCKED";
          else if (u.activatedAt) situation = "ACTIVE";
          else if (!u.firstAccessEligible) situation = "LEGACY_UNCLASSIFIED";
          else if (faltam.length > 0) situation = "MISSING_DATA";
          else if (!u.firstAccessUntil || u.firstAccessUntil <= agora) situation = "WINDOW_EXPIRED";
          else situation = "AWAITING";
          const unidade = ficha?.establishment ?? null;
          return {
            userId: u.id,
            name: u.name,
            login: u.login,
            role: m.role,
            suspended: m.suspendedAt !== null || !u.active,
            establishment: unidade,
            situation,
            activatedAt: u.activatedAt,
            firstAccessEligible: u.firstAccessEligible,
            firstAccessUntil: u.firstAccessUntil,
            lockedUntil: ate ?? null,
            missing: faltam,
            lastSigninAt: entradaPor.get(u.id) ?? null,
            failures24h: errosPor.get(u.id) ?? 0,
          };
        });

      const totais: Record<string, { name: string; counts: Record<string, number> }> = {};
      for (const p of people) {
        const chave = p.establishment?.id ?? "sem-unidade";
        totais[chave] ??= { name: p.establishment?.name ?? "Sem unidade", counts: {} };
        totais[chave].counts[p.situation] = (totais[chave].counts[p.situation] ?? 0) + 1;
      }

      res.json({
        people,
        totals_by_unit: Object.entries(totais).map(([id, t]) => ({ id, ...t })),
        can_act: podeAgir(auth),
      });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Reabrir o primeiro acesso: só para conta nunca ativada e já elegível
   * (nova pela planilha, ou antiga já classificada). Zera as tentativas,
   * revoga as fichas e dá mais 30 dias. Conta já ativada usa o reset.
   */
  async reopen(req: Request, res: Response) {
    try {
      const a = await alvo(req, res);
      if (!a) return;
      if (a.user.activatedAt || !a.user.firstAccessEligible) {
        res.status(409).json({
          message: a.user.activatedAt
            ? "Esta conta já foi ativada: use Redefinir senha."
            : "Conta antiga ainda não classificada: classifique antes de reabrir.",
        });
        return;
      }
      if (await temVinculoEmOutraEmpresa(a.orgId, a.user.id)) {
        res.status(409).json({
          message: "Esta conta também tem acesso em outra empresa: use Redefinir senha.",
          code: "OTHER_ORG",
        });
        return;
      }
      await abrirPrimeiroAcesso(a.user);
      await writeAudit({
        organizationId: a.orgId,
        actorId: a.actorId,
        action: "user.first_access_reopened",
        entityType: "User",
        entityId: a.user.id,
      });
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Classificar uma conta antiga, com justificativa escrita. [C1-7]
   *
   * - "Nunca entrou" (`NEVER_SIGNED_IN`) libera o primeiro acesso. É
   *   recusado quando a trilha registra uma entrada da conta: a evidência
   *   contradiz.
   * - "Já usa a conta" (`IN_USE`) marca como ativada; o caminho dela, se
   *   travar, é o reset.
   */
  async classify(req: Request, res: Response) {
    try {
      const a = await alvo(req, res);
      if (!a) return;
      const { outcome, reason } = req.body as { outcome?: unknown; reason?: unknown };
      if (outcome !== "NEVER_SIGNED_IN" && outcome !== "IN_USE") {
        res.status(400).json({ message: "Escolha: nunca entrou, ou já usa a conta.", field: "outcome" });
        return;
      }
      const justificativa = typeof reason === "string" ? reason.trim() : "";
      if (!justificativa) {
        res.status(400).json({ message: "Escreva a justificativa da classificação.", field: "reason" });
        return;
      }
      if (a.user.activatedAt || a.user.firstAccessEligible) {
        res.status(409).json({ message: "Esta conta já está classificada." });
        return;
      }
      if (outcome === "NEVER_SIGNED_IN") {
        if (await temVinculoEmOutraEmpresa(a.orgId, a.user.id)) {
          res.status(409).json({
            message:
              'Esta conta também tem acesso em outra empresa: não pode ser classificada como "nunca entrou". Use Redefinir senha.',
            code: "OTHER_ORG",
          });
          return;
        }
        const entrada = await ultimaEntrada(a.user.id);
        if (entrada) {
          res.status(409).json({
            message: `A trilha registra entrada desta conta em ${entrada.toLocaleDateString("pt-BR", {
              timeZone: "America/Sao_Paulo",
            })}: ela não pode ser classificada como "nunca entrou".`,
            code: "HAS_SIGNIN",
          });
          return;
        }
      }

      await writeAudit({
        organizationId: a.orgId,
        actorId: a.actorId,
        action: "user.legacy_classified",
        entityType: "User",
        entityId: a.user.id,
        after: { outcome, reason: justificativa },
      });
      if (outcome === "IN_USE") {
        await prisma.user.update({ where: { id: a.user.id }, data: { activatedAt: new Date() } });
      } else {
        await abrirPrimeiroAcesso(a.user);
        await writeAudit({
          organizationId: a.orgId,
          actorId: a.actorId,
          action: "user.first_access_reopened",
          entityType: "User",
          entityId: a.user.id,
        });
      }
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new AccountActivationController();
