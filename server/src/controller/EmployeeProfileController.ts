import { Request, Response } from "express";
import { AccessSuspensionReason, Prisma, WorkerBond } from "@prisma/client";
import prisma from "../model/prisma";
import { EmployeeProfile } from "../model/schema/EmployeeProfile/EmployeeProfile";
import { JobRole } from "../model/schema/JobRole/JobRole";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { isValidCpf, normalizeCpf } from "../helper/cpf";
import {
  canChangePersonnelRecord,
  canManageModule,
  canReadModule,
  canSeeAllInModule,
  isReadOnlyRole,
} from "../helper/module-access";
import type { AuthRequest } from "../types/auth";

/**
 * CPF da ficha: vazio é aceito (fica pendente); preenchido, tem de ser CPF de
 * verdade — 11 dígitos com os verificadores batendo. CNPJ não é CPF. [S5-N]
 */
function cpfDoColaborador(raw: unknown): string | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const cpf = normalizeCpf(String(raw));
  if (!isValidCpf(cpf)) {
    throw Object.assign(new Error("CPF inválido — confira os números."), { status: 400 });
  }
  return cpf;
}

function fail(res: Response, err: unknown) {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    res.status(409).json({
      message:
        "Já existe perfil com este user_id, matrícula ou CPF nesta organização.",
    });
    return;
  }
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function blank(v?: string | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

/**
 * Data do desligamento (`AAAA-MM-DD`), gravada como meia-noite UTC — é data
 * de calendário, não instante. Vazio é hoje; o futuro não se registra, porque
 * desligamento que ainda não aconteceu não corta acesso de ninguém.
 */
function dismissalDate(raw: unknown): Date {
  const hojeBrasilia = new Date(Date.now() - 3 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const value =
    raw === undefined || raw === null || String(raw).trim() === ""
      ? hojeBrasilia
      : String(raw).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw Object.assign(new Error("Data do desligamento inválida. Use AAAA-MM-DD."), {
      status: 400,
    });
  }
  if (value > hojeBrasilia) {
    throw Object.assign(
      new Error("O desligamento não pode ter data no futuro."),
      { status: 400 },
    );
  }
  return new Date(`${value}T00:00:00.000Z`);
}

function isRh(req: AuthRequest): boolean {
  return Boolean(req.actor && canManageModule(req.actor.permission, "colaboradores"));
}

/**
 * Desligar e mexer em CPF ou matrícula: só quem responde pelo quadro de
 * pessoal. Escrever em Colaboradores, por si, não dá esse poder. [OB-8]
 */
function cuidaDoQuadro(req: AuthRequest): boolean {
  return Boolean(req.actor && canChangePersonnelRecord(req.actor.permission));
}

function seesAll(req: AuthRequest): boolean {
  return Boolean(req.actor && canSeeAllInModule(req.actor.permission, "colaboradores"));
}

/**
 * A consulta (fiscal) vê quem é quem — nome, matrícula, função, setor,
 * admissão — sem CPF, telefone, login nem e-mail [S7-A], e sem o motivo do
 * desligamento: por que alguém saiu da empresa não é assunto da
 * fiscalização de segurança, e já era regra não expor isso a quem está do
 * lado de fora. [CB-43] [CB-39]
 */
function forViewer<
  T extends {
    taxId?: unknown;
    phone?: unknown;
    user?: unknown;
    dismissalReason?: unknown;
  },
>(req: AuthRequest, profile: T): T {
  if (!req.actor || !isReadOnlyRole(req.actor.permission)) return profile;
  const user = profile.user as { id: string; name: string } | undefined;
  return {
    ...profile,
    taxId: null,
    phone: null,
    ...("dismissalReason" in profile ? { dismissalReason: null } : {}),
    user: user ? { id: user.id, name: user.name } : user,
  };
}

/**
 * O que mudou na ficha, campo a campo, com o valor de antes e o de agora.
 *
 * O histórico registrava "Ficha alterada" e nada mais: função, vínculo,
 * empresa contratada, CPF e matrícula ficavam gravados sem o antes nem o
 * depois, e não dava para saber o que alguém tinha mudado. [CB-54]
 */
const CAMPOS_DA_FICHA: Record<string, string> = {
  registration: "matrícula",
  taxId: "CPF",
  phone: "telefone",
  jobRoleId: "função",
  bond: "vínculo",
  contractorId: "empresa contratada",
  admittedAt: "admissão",
  dismissedAt: "desligamento",
};

/** Campos que não se mostram a quem não pode vê-los na própria ficha. [CB-43] */
const CAMPOS_RESERVADOS = new Set(["taxId", "phone"]);

function comoTexto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor);
}

export function diffDaFicha(
  antes: Record<string, unknown>,
  depois: Record<string, unknown>,
): { field: string; label: string; from: string | null; to: string | null }[] {
  const mudou: { field: string; label: string; from: string | null; to: string | null }[] = [];
  for (const [campo, label] of Object.entries(CAMPOS_DA_FICHA)) {
    const de = comoTexto(antes[campo]);
    const para = comoTexto(depois[campo]);
    if (de !== para) mudou.push({ field: campo, label, from: de, to: para });
  }
  return mudou;
}

class EmployeeProfileController {
  async list(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const includeDismissed = req.query.include_dismissed === "true";
      const jobRoleId = req.query.job_role_id as string | undefined;

      // Colaborador sem RH só vê o próprio perfil.
      if (!seesAll(auth)) {
        const mine = await prisma.employeeProfile.findFirst({
          where: { organizationId: orgId, userId: actorUserId(auth) },
          include: {
            user: { select: { id: true, name: true, login: true, email: true } },
            jobRole: { select: { id: true, name: true } },
          },
        });
        res.json({ profiles: mine ? [mine] : [] });
        return;
      }

      const rows = await prisma.employeeProfile.findMany({
        where: {
          organizationId: orgId,
          ...(includeDismissed ? {} : { dismissedAt: null }),
          ...(jobRoleId ? { jobRoleId } : {}),
        },
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, name: true, login: true, email: true } },
          jobRole: { select: { id: true, name: true } },
          contractor: { select: { id: true, name: true } },
        },
      });
      res.json({ profiles: rows.map((p) => forViewer(auth, p)) });
    } catch (err) {
      fail(res, err);
    }
  }

  async get(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const profile = await prisma.employeeProfile.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: {
          user: { select: { id: true, name: true, login: true, email: true } },
          jobRole: { select: { id: true, name: true, sectorId: true } },
        },
      });
      if (!profile) {
        res.status(404).json({ message: "Perfil não encontrado." });
        return;
      }
      if (!seesAll(auth) && profile.userId !== actorUserId(auth)) {
        res.status(403).json({ message: "Sem permissão para ver este perfil." });
        return;
      }
      res.json({ profile: forViewer(auth, profile) });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * A ficha da pessoa: tudo o que a empresa tem sobre o vínculo dela, numa
   * tela — cadastro, função, acesso ao portal, o que a função exige e o que
   * ela cumpriu, a ordem de serviço e as ações no nome dela. [S6-C]
   *
   * Cada bloco respeita o módulo de onde vem: exame ocupacional só para quem
   * cuida de Saúde; ação só para quem lê o plano de ação.
   */
  async file(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);

      const profile = await prisma.employeeProfile.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: {
          user: { select: { id: true, name: true, login: true, email: true, active: true } },
          dismissedBy: { select: { id: true, name: true } },
          contractor: { select: { id: true, name: true, taxId: true, relation: true } },
          jobRole: {
            select: {
              id: true,
              name: true,
              description: true,
              sector: {
                select: { id: true, name: true, establishment: { select: { id: true, name: true } } },
              },
            },
          },
        },
      });
      if (!profile) {
        res.status(404).json({ message: "Ficha não encontrada." });
        return;
      }
      const propria = profile.userId === userId;
      if (!propria && !seesAll(auth)) {
        res.status(403).json({ message: "Sem permissão para ver esta ficha." });
        return;
      }

      const veSaude = Boolean(
        auth.actor && canSeeAllInModule(auth.actor.permission, "saude"),
      );
      const veAcoes = Boolean(
        auth.actor && canReadModule(auth.actor.permission, "acoes"),
      );

      const [membership, exigencias, certificados, exames, ordem, acoes, historico] =
        await Promise.all([
          prisma.membership.findFirst({
            where: { userId: profile.userId, organizationId: orgId },
            select: {
              role: true,
              accessExpiresAt: true,
              suspendedAt: true,
              suspensionReason: true,
            },
          }),
          profile.jobRoleId
            ? prisma.jobRoleRequirement.findMany({
                where: { organizationId: orgId, jobRoleId: profile.jobRoleId },
                select: { id: true, kind: true, name: true, validityMonths: true },
                orderBy: { name: "asc" },
              })
            : Promise.resolve([]),
          prisma.workerCertificate.findMany({
            where: { organizationId: orgId, userId: profile.userId },
            select: {
              id: true,
              requirementId: true,
              name: true,
              status: true,
              issuedAt: true,
              expiresAt: true,
              storagePath: true,
            },
            orderBy: { createdAt: "desc" },
          }),
          veSaude || propria
            ? prisma.occupationalExam.findMany({
                where: { organizationId: orgId, userId: profile.userId },
                select: { id: true, kind: true, performedAt: true, dueAt: true },
                orderBy: { performedAt: "desc" },
                take: 10,
              })
            : Promise.resolve([]),
          profile.jobRoleId
            ? prisma.serviceOrder.findFirst({
                where: { organizationId: orgId, jobRoleId: profile.jobRoleId },
                orderBy: { version: "desc" },
                select: {
                  id: true,
                  version: true,
                  issuedAt: true,
                  acks: {
                    where: { userId: profile.userId },
                    select: { acknowledgedAt: true },
                  },
                },
              })
            : Promise.resolve(null),
          veAcoes
            ? prisma.action.findMany({
                where: { organizationId: orgId, assigneeId: profile.userId },
                select: { id: true, title: true, status: true, dueDate: true },
                orderBy: { dueDate: "asc" },
                take: 20,
              })
            : Promise.resolve([]),
          prisma.auditEvent.findMany({
            where: {
              organizationId: orgId,
              entityType: "EmployeeProfile",
              entityId: profile.id,
            },
            orderBy: { createdAt: "desc" },
            take: 20,
            select: {
              id: true,
              action: true,
              createdAt: true,
              /** O que mudou, de quê para quê. [CB-54] */
              context: true,
              actor: { select: { name: true } },
            },
          }),
        ]);

      const agora = new Date();
      const porExigencia = new Map<string, (typeof certificados)[number]>();
      for (const c of certificados) {
        if (c.requirementId && !porExigencia.has(c.requirementId)) {
          porExigencia.set(c.requirementId, c);
        }
      }

      /* Mesma regra do perfil: quem só consulta não vê CPF nem telefone. [CB-43] */
      const escondeReservado = Boolean(
        auth.actor && isReadOnlyRole(auth.actor.permission),
      );
      res.json({
        profile: forViewer(auth, profile),
        membership: membership
          ? {
              role: membership.role,
              access_expires_at: membership.accessExpiresAt,
              suspended_at: membership.suspendedAt,
              suspension_reason: membership.suspensionReason,
              access_active:
                profile.user.active &&
                !membership.suspendedAt &&
                !(membership.accessExpiresAt && membership.accessExpiresAt <= agora),
            }
          : null,
        requirements: exigencias.map((q) => {
          const cert = porExigencia.get(q.id);
          // Aceito mas vencido não é "em dia": é o caso que mais engana.
          const situacao = !cert
            ? "missing"
            : cert.status !== "APPROVED"
              ? cert.status.toLowerCase()
              : cert.expiresAt && cert.expiresAt <= agora
                ? "expired"
                : "ok";
          return {
            id: q.id,
            kind: q.kind,
            name: q.name,
            validity_months: q.validityMonths,
            status: situacao,
            certificate: cert
              ? {
                  id: cert.id,
                  name: cert.name,
                  issued_at: cert.issuedAt,
                  expires_at: cert.expiresAt,
                  has_file: Boolean(cert.storagePath),
                }
              : null,
          };
        }),
        certificates: certificados.map(({ storagePath, ...c }) => ({
          ...c,
          has_file: Boolean(storagePath),
        })),
        exams: exames,
        service_order: ordem
          ? {
              id: ordem.id,
              version: ordem.version,
              issued_at: ordem.issuedAt,
              acknowledged_at: ordem.acks[0]?.acknowledgedAt ?? null,
            }
          : null,
        actions: acoes,
        history: historico.map((h) => ({
          id: h.id,
          action: h.action,
          at: h.createdAt,
          who: h.actor?.name ?? "sistema",
          /*
            O que mudou, de quê para quê [CB-54] — com CPF e telefone fora
            para quem não os vê na própria ficha, que é a mesma regra do
            CB-43: o histórico não pode ser a porta dos fundos.
          */
          changes: (
            ((h.context as { changes?: unknown } | null)?.changes ?? []) as {
              field: string;
              label: string;
              from: string | null;
              to: string | null;
            }[]
          ).map((m) =>
            escondeReservado && CAMPOS_RESERVADOS.has(m.field)
              ? { ...m, from: null, to: null, hidden: true }
              : { ...m, hidden: false },
          ),
        })),
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async getMine(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const profile = await prisma.employeeProfile.findFirst({
        where: { organizationId: orgId, userId },
        include: {
          user: { select: { id: true, name: true, login: true, email: true } },
          jobRole: { select: { id: true, name: true } },
        },
      });
      if (!profile) {
        res.status(404).json({ message: "Você ainda não tem perfil nesta organização." });
        return;
      }
      res.json({ profile });
    } catch (err) {
      fail(res, err);
    }
  }

  async create(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const actorId = actorUserId(auth);
      const {
        user_id,
        registration,
        tax_id,
        phone,
        job_role_id,
        admitted_at,
      } = req.body as {
        user_id?: string;
        registration?: string;
        tax_id?: string;
        phone?: string;
        job_role_id?: string;
        admitted_at?: string;
      };

      if (!user_id) {
        res.status(400).json({ message: "Informe user_id." });
        return;
      }

      const membership = await prisma.membership.findFirst({
        where: { userId: user_id, organizationId: orgId },
      });
      if (!membership) {
        res.status(400).json({
          message: "Usuário não é membro desta organização.",
        });
        return;
      }

      if (job_role_id) {
        const role = await new JobRole().read.one({
          id: job_role_id,
          organizationId: orgId,
          archivedAt: null,
        });
        if (!role) {
          res.status(400).json({ message: "Função (job_role) inválida." });
          return;
        }
      }

      const taxId = cpfDoColaborador(tax_id);

      const profile = await new EmployeeProfile().create.new({
        organizationId: orgId,
        userId: user_id,
        registration: blank(registration),
        taxId,
        phone: blank(phone),
        jobRoleId: job_role_id ?? null,
        admittedAt: admitted_at ? new Date(admitted_at) : null,
      });

      await writeAudit({
        organizationId: orgId,
        actorId,
        action: "employee_profile.create",
        entityType: "EmployeeProfile",
        entityId: profile.id,
        after: { userId: profile.userId, registration: profile.registration },
      });

      res.status(201).json({ profile });
    } catch (err) {
      fail(res, err);
    }
  }

  async update(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const actorId = actorUserId(auth);
      const current = await new EmployeeProfile().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!current) {
        res.status(404).json({ message: "Perfil não encontrado." });
        return;
      }

      const body = req.body as Record<string, unknown>;
      const rh = isRh(auth);
      const isOwner = current.userId === actorUserId(auth);

      // Sem RH: só telefone próprio.
      if (!rh) {
        if (!isOwner) {
          res.status(403).json({ message: "Sem permissão." });
          return;
        }
        const profile = await new EmployeeProfile().update.one(
          { id: current.id, organizationId: orgId },
          {
            ...(body.phone !== undefined
              ? { phone: blank(body.phone as string) }
              : {}),
          },
        );
        res.json({ profile });
        return;
      }

      if (body.job_role_id) {
        const role = await new JobRole().read.one({
          id: body.job_role_id as string,
          organizationId: orgId,
          archivedAt: null,
        });
        if (!role) {
          res.status(400).json({ message: "Função (job_role) inválida." });
          return;
        }
      }

      // CPF e matrícula são identidade: não entram por escrita comum. [OB-8]
      if (
        (body.tax_id !== undefined || body.registration !== undefined) &&
        !cuidaDoQuadro(auth)
      ) {
        res.status(403).json({
          message: "CPF e matrícula só podem ser alterados pelo RH.",
          code: "PERSONNEL_RECORD_ONLY",
        });
        return;
      }
      // Encerrar o vínculo tem rota própria, com data e motivo. [S5-H] [OB-8]
      if (body.dismissed_at !== undefined && !cuidaDoQuadro(auth)) {
        res.status(403).json({
          message: "O desligamento só pode ser registrado pelo RH.",
          code: "PERSONNEL_RECORD_ONLY",
        });
        return;
      }

      let taxId: string | null | undefined;
      if (body.tax_id !== undefined) {
        taxId = cpfDoColaborador(body.tax_id);
      }

      // Vínculo e empresa contratada andam juntos: empregado não pertence a
      // contratada, e terceirizado sem empresa deixa a lacuna à mostra. [S1-G]
      const bond =
        body.bond !== undefined ? (String(body.bond) as WorkerBond) : undefined;
      if (bond !== undefined && !Object.values(WorkerBond).includes(bond)) {
        res.status(400).json({
          message: `Vínculo inválido. Use: ${Object.values(WorkerBond).join(", ")}.`,
        });
        return;
      }
      const contractorId =
        body.contractor_id !== undefined
          ? blank(body.contractor_id as string)
          : undefined;
      if (contractorId) {
        const contratada = await prisma.contractor.findFirst({
          where: { id: contractorId, organizationId: orgId, archivedAt: null },
          select: { id: true },
        });
        if (!contratada) {
          res.status(400).json({ message: "Empresa contratada inválida." });
          return;
        }
      }
      const vinculoFinal = bond ?? current.bond;
      const contratadaFinal =
        contractorId !== undefined ? contractorId : current.contractorId;
      if (contratadaFinal && vinculoFinal === WorkerBond.EMPLOYEE) {
        res.status(400).json({
          message: "Empregado não pertence a empresa contratada — mude o vínculo antes.",
        });
        return;
      }

      const profile = await new EmployeeProfile().update.one(
        { id: current.id, organizationId: orgId },
        {
          ...(body.registration !== undefined
            ? { registration: blank(body.registration as string) }
            : {}),
          ...(taxId !== undefined ? { taxId } : {}),
          ...(body.phone !== undefined
            ? { phone: blank(body.phone as string) }
            : {}),
          ...(body.job_role_id !== undefined
            ? { jobRoleId: (body.job_role_id as string) || null }
            : {}),
          ...(bond !== undefined ? { bond } : {}),
          ...(contractorId !== undefined ? { contractorId } : {}),
          ...(body.admitted_at !== undefined
            ? {
                admittedAt: body.admitted_at
                  ? new Date(String(body.admitted_at))
                  : null,
              }
            : {}),
          ...(body.dismissed_at !== undefined
            ? {
                dismissedAt: body.dismissed_at
                  ? new Date(String(body.dismissed_at))
                  : null,
              }
            : {}),
        },
      );

      /*
        Antes ficava só "Ficha alterada". O que mudou, de quê para quê, é o
        que a trilha existe para responder. [CB-54]
      */
      const mudancas = diffDaFicha(
        current as unknown as Record<string, unknown>,
        (profile ?? current) as unknown as Record<string, unknown>,
      );
      await writeAudit({
        organizationId: orgId,
        actorId,
        action: "employee_profile.update",
        entityType: "EmployeeProfile",
        entityId: current.id,
        before: Object.fromEntries(mudancas.map((m) => [m.field, m.from])),
        after: Object.fromEntries(mudancas.map((m) => [m.field, m.to])),
        context: { changes: mudancas },
      });

      res.json({ profile });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Registra o desligamento: data, motivo, quem registrou — e CORTA O ACESSO.
   *
   * Desligar e deixar a pessoa entrando é o defeito: ela continua vendo
   * holerite, mural e documento da empresa. Sai na hora, mesmo com sessão
   * aberta, pelo mesmo mecanismo do prazo do fiscal. [S5-H]
   */
  async dismiss(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const actorId = actorUserId(auth);
      const current = await new EmployeeProfile().read.one({
        id: req.params.id,
        organizationId: orgId,
        dismissedAt: null,
      });
      if (!current) {
        res.status(404).json({ message: "Perfil ativo não encontrado." });
        return;
      }

      // Ninguém registra a própria saída: é ato do empregador sobre o
      // empregado, e quem registra perde o acesso no mesmo instante — ficaria
      // trancado do lado de fora no meio da operação. [S5-H]
      if (current.userId === actorId) {
        res.status(400).json({
          message:
            "Outra pessoa do RH registra o seu desligamento — registrar o próprio tiraria seu acesso na hora.",
        });
        return;
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const dismissedAt = dismissalDate(body.dismissed_at);
      if (current.admittedAt && dismissedAt < current.admittedAt) {
        res.status(400).json({
          message: "O desligamento não pode ser anterior à admissão.",
        });
        return;
      }

      const agora = new Date();
      const profile = await prisma.$transaction(async (tx) => {
        const updated = await tx.employeeProfile.update({
          where: { id: current.id },
          data: {
            dismissedAt,
            dismissalReason: blank(body.reason as string),
            dismissedById: actorId,
          },
          include: {
            user: { select: { id: true, name: true, login: true, email: true } },
            jobRole: { select: { id: true, name: true } },
            dismissedBy: { select: { id: true, name: true } },
          },
        });

        /*
          O corte do desligamento tem campo próprio: antes ia no mesmo
          `accessExpiresAt` do prazo do fiscal, e as duas coisas apareciam
          iguais na tela e na recusa de entrada. [CB-39]
        */
        await tx.membership.updateMany({
          where: { userId: current.userId, organizationId: orgId },
          data: {
            suspendedAt: agora,
            suspensionReason: AccessSuspensionReason.DISMISSAL,
            suspendedById: actorId,
          },
        });
        await tx.token.deleteMany({ where: { userId: current.userId } });

        return updated;
      });

      await writeAudit({
        organizationId: orgId,
        actorId,
        action: "employee_profile.dismiss",
        entityType: "EmployeeProfile",
        entityId: current.id,
        after: {
          dismissedAt: profile.dismissedAt,
          reason: profile.dismissalReason,
        },
      });

      res.json({ profile, access_revoked: true });
    } catch (err) {
      fail(res, err);
    }
  }

  /** Desligamento registrado por engano: desfaz e devolve o acesso. [S5-H] */
  async reinstate(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const actorId = actorUserId(auth);
      const current = await prisma.employeeProfile.findFirst({
        where: { id: req.params.id, organizationId: orgId },
      });
      if (!current || !current.dismissedAt) {
        res.status(404).json({ message: "Perfil desligado não encontrado." });
        return;
      }

      const profile = await prisma.$transaction(async (tx) => {
        const updated = await tx.employeeProfile.update({
          where: { id: current.id },
          data: { dismissedAt: null, dismissalReason: null, dismissedById: null },
          include: {
            user: { select: { id: true, name: true, login: true, email: true } },
            jobRole: { select: { id: true, name: true } },
          },
        });
        // Devolve só o que o desligamento tirou: suspensão manual e prazo
        // do fiscal continuam de pé.
        await tx.membership.updateMany({
          where: {
            userId: current.userId,
            organizationId: orgId,
            suspensionReason: AccessSuspensionReason.DISMISSAL,
          },
          data: { suspendedAt: null, suspensionReason: null, suspendedById: null },
        });
        return updated;
      });

      await writeAudit({
        organizationId: orgId,
        actorId,
        action: "employee_profile.reinstate",
        entityType: "EmployeeProfile",
        entityId: current.id,
        before: {
          dismissedAt: current.dismissedAt,
          reason: current.dismissalReason,
        },
      });

      res.json({ profile });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new EmployeeProfileController();
