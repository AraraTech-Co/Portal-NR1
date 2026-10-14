import bcrypt from "bcryptjs";
import { AccountRole, Prisma, Role, WorkerBond } from "@prisma/client";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { canAssignOrgRole } from "../helper/invite-access";
import { isValidCpf, normalizeCpf } from "../helper/cpf";
import {
  allocateUniqueLogin,
  loginCandidateFromEmail,
  loginCandidateFromName,
} from "../helper/login-name";
import { temporaryPassword } from "../helper/temporary-password";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

/** Uma leva por vez: a tela mostra o resultado linha a linha. */
const MAX_ROWS = 200;

type Entrada = {
  name?: unknown;
  registration?: unknown;
  tax_id?: unknown;
  email?: unknown;
  job_role_id?: unknown;
  admitted_at?: unknown;
  bond?: unknown;
  contractor_id?: unknown;
  org_role?: unknown;
};

type Resultado = {
  line: number;
  name: string;
  status: "created" | "skipped" | "error";
  /** Por que a linha não entrou, na língua de quem vai consertar a planilha. */
  message?: string;
  login?: string;
  /** Só na criação de verdade, e só uma vez: o RH entrega e o portal esquece. */
  temporary_password?: string;
};

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function dataDeCalendario(raw: unknown, campo: string): Date | null {
  const value = texto(raw);
  if (!value) return null;
  const dia = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || Number.isNaN(Date.parse(`${dia}T00:00:00Z`))) {
    throw new Error(`${campo} inválida — use AAAA-MM-DD.`);
  }
  return new Date(`${dia}T00:00:00.000Z`);
}

class PeopleImportController {
  /**
   * Cadastra várias pessoas de uma vez, a partir de uma planilha colada.
   *
   * Cada linha é independente: o que já existe é pulado, o que está errado é
   * devolvido com o motivo, e o resto entra. Importação que aborta inteira no
   * primeiro CPF repetido obriga a conferir 200 linhas à mão. [S1-A]
   *
   * `dry_run` confere sem gravar nada — é o que a tela usa para a prévia.
   */
  async importPeople(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const actor = auth.actor!;
      const orgId = actorOrgId(auth);
      const body = req.body as { people?: Entrada[]; dry_run?: boolean };
      const linhas = Array.isArray(body.people) ? body.people : null;
      const simulacao = body.dry_run === true;

      if (!linhas || linhas.length === 0) {
        res.status(400).json({ message: "Nenhuma linha para importar." });
        return;
      }
      if (linhas.length > MAX_ROWS) {
        res.status(400).json({
          message: `São ${linhas.length} linhas e o limite é ${MAX_ROWS} por vez. Divida a planilha.`,
        });
        return;
      }

      const [funcoes, contratadas] = await Promise.all([
        prisma.jobRole.findMany({
          where: { organizationId: orgId, archivedAt: null },
          select: { id: true },
        }),
        prisma.contractor.findMany({
          where: { organizationId: orgId, archivedAt: null },
          select: { id: true },
        }),
      ]);
      const funcaoValida = new Set(funcoes.map((f) => f.id));
      const contratadaValida = new Set(contratadas.map((c) => c.id));

      const resultados: Resultado[] = [];
      /** Repetição dentro da própria planilha, que o banco não pega na prévia. */
      const cpfsDaLeva = new Set<string>();
      const matriculasDaLeva = new Set<string>();
      const emailsDaLeva = new Set<string>();

      for (const [indice, linha] of linhas.entries()) {
        const numero = indice + 1;
        const nome = texto(linha.name);
        const registro: Resultado = {
          line: numero,
          name: nome ?? "",
          status: "error",
        };

        try {
          if (!nome) throw new Error("Informe o nome.");

          const matricula = texto(linha.registration);
          const email = texto(linha.email)?.toLowerCase() ?? null;
          const jobRoleId = texto(linha.job_role_id);
          const admittedAt = dataDeCalendario(linha.admitted_at, "Data de admissão");

          let taxId: string | null = null;
          const cpfBruto = texto(linha.tax_id);
          if (cpfBruto) {
            taxId = normalizeCpf(cpfBruto);
            if (!isValidCpf(taxId)) throw new Error("CPF inválido — confira os números.");
          }

          if (jobRoleId && !funcaoValida.has(jobRoleId)) {
            throw new Error("Função não existe nesta empresa.");
          }

          const bond = (texto(linha.bond) ?? WorkerBond.EMPLOYEE) as WorkerBond;
          if (!Object.values(WorkerBond).includes(bond)) {
            throw new Error("Vínculo inválido.");
          }
          const contractorId = texto(linha.contractor_id);
          if (contractorId && !contratadaValida.has(contractorId)) {
            throw new Error("Empresa contratada não existe nesta empresa.");
          }
          if (contractorId && bond === WorkerBond.EMPLOYEE) {
            throw new Error("Empregado não pertence a empresa contratada.");
          }

          const orgRole = (texto(linha.org_role) ?? Role.COLABORADOR) as Role;
          if (!Object.values(Role).includes(orgRole)) {
            throw new Error("Papel inválido.");
          }
          if (!canAssignOrgRole(actor, orgRole)) {
            throw new Error("Você não pode dar este papel.");
          }

          // Repetido dentro da própria planilha.
          if (taxId && cpfsDaLeva.has(taxId)) throw new Error("CPF repetido na planilha.");
          if (matricula && matriculasDaLeva.has(matricula)) {
            throw new Error("Matrícula repetida na planilha.");
          }
          if (email && emailsDaLeva.has(email)) throw new Error("E-mail repetido na planilha.");

          // Já cadastrado: pular é o certo, não é erro de quem montou a planilha.
          const [porCpf, porMatricula, porEmail] = await Promise.all([
            taxId
              ? prisma.employeeProfile.findFirst({
                  where: { organizationId: orgId, taxId },
                  select: { user: { select: { name: true, login: true } } },
                })
              : null,
            matricula
              ? prisma.employeeProfile.findFirst({
                  where: { organizationId: orgId, registration: matricula },
                  select: { user: { select: { name: true, login: true } } },
                })
              : null,
            email
              ? prisma.user.findFirst({ where: { email }, select: { login: true } })
              : null,
          ]);
          if (porCpf) {
            registro.status = "skipped";
            registro.login = porCpf.user.login;
            registro.message = `Já cadastrado com este CPF (${porCpf.user.name}).`;
            resultados.push(registro);
            continue;
          }
          if (porMatricula) {
            registro.status = "skipped";
            registro.login = porMatricula.user.login;
            registro.message = `Já cadastrado com esta matrícula (${porMatricula.user.name}).`;
            resultados.push(registro);
            continue;
          }
          if (porEmail) {
            registro.status = "skipped";
            registro.login = porEmail.login;
            registro.message = "Já existe conta com este e-mail.";
            resultados.push(registro);
            continue;
          }

          if (taxId) cpfsDaLeva.add(taxId);
          if (matricula) matriculasDaLeva.add(matricula);
          if (email) emailsDaLeva.add(email);

          const base = matricula
            ? loginCandidateFromName(nome)
            : email
              ? loginCandidateFromEmail(email)
              : loginCandidateFromName(nome);

          if (simulacao) {
            registro.status = "created";
            registro.login = await allocateUniqueLogin(base, prisma);
            registro.message = "Pronto para entrar.";
            resultados.push(registro);
            continue;
          }

          const senha = temporaryPassword();
          const criado = await prisma.$transaction(async (tx) => {
            const login = await allocateUniqueLogin(base, tx);
            const user = await tx.user.create({
              data: {
                login,
                email,
                name: nome,
                passwordHash: await bcrypt.hash(senha, 10),
                mustChangePassword: true,
              },
            });
            await tx.membership.create({
              data: { userId: user.id, organizationId: orgId, role: orgRole },
            });
            await tx.accountMembership.create({
              data: { accountId: actor.accountId, userId: user.id, role: AccountRole.USER },
            });
            await tx.employeeProfile.create({
              data: {
                organizationId: orgId,
                userId: user.id,
                registration: matricula,
                taxId,
                jobRoleId,
                admittedAt,
                bond,
                contractorId,
              },
            });
            return { id: user.id, login };
          });

          await writeAudit({
            organizationId: orgId,
            actorId: actor.userId,
            action: "employee_profile.create",
            entityType: "User",
            entityId: criado.id,
            after: { via: "import", registration: matricula, bond },
          });

          registro.status = "created";
          registro.login = criado.login;
          registro.temporary_password = senha;
          resultados.push(registro);
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002"
          ) {
            registro.status = "skipped";
            registro.message = "Já existe alguém com este login, CPF, matrícula ou e-mail.";
          } else {
            registro.message =
              err instanceof Error ? err.message : "Não foi possível importar esta linha.";
          }
          resultados.push(registro);
        }
      }

      const criados = resultados.filter((r) => r.status === "created").length;
      if (!simulacao && criados > 0) {
        await writeAudit({
          organizationId: orgId,
          actorId: actor.userId,
          action: "people.import",
          entityType: "Organization",
          entityId: orgId,
          after: {
            rows: resultados.length,
            created: criados,
            skipped: resultados.filter((r) => r.status === "skipped").length,
            errors: resultados.filter((r) => r.status === "error").length,
          },
        });
      }

      res.status(simulacao ? 200 : 201).json({
        dry_run: simulacao,
        rows: resultados.length,
        created: criados,
        skipped: resultados.filter((r) => r.status === "skipped").length,
        errors: resultados.filter((r) => r.status === "error").length,
        results: resultados,
      });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new PeopleImportController();
