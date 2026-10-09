import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../model/prisma";
import { EmployeeProfile } from "../model/schema/EmployeeProfile/EmployeeProfile";
import { JobRole } from "../model/schema/JobRole/JobRole";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { isValidCpf, normalizeCpf } from "../helper/cpf";
import { canManageModule } from "../helper/module-access";
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

function isRh(req: AuthRequest): boolean {
  return Boolean(req.actor && canManageModule(req.actor.permission, "colaboradores"));
}

class EmployeeProfileController {
  async list(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const includeDismissed = req.query.include_dismissed === "true";
      const jobRoleId = req.query.job_role_id as string | undefined;

      // Colaborador sem RH só vê o próprio perfil.
      if (!isRh(auth)) {
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
        },
      });
      res.json({ profiles: rows });
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
      if (!isRh(auth) && profile.userId !== actorUserId(auth)) {
        res.status(403).json({ message: "Sem permissão para ver este perfil." });
        return;
      }
      res.json({ profile });
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

      let taxId: string | null | undefined;
      if (body.tax_id !== undefined) {
        taxId = cpfDoColaborador(body.tax_id);
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

      await writeAudit({
        organizationId: orgId,
        actorId,
        action: "employee_profile.update",
        entityType: "EmployeeProfile",
        entityId: current.id,
      });

      res.json({ profile });
    } catch (err) {
      fail(res, err);
    }
  }

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

      const profile = await new EmployeeProfile().update.one(
        { id: current.id, organizationId: orgId },
        { dismissedAt: new Date() },
      );

      await writeAudit({
        organizationId: orgId,
        actorId,
        action: "employee_profile.dismiss",
        entityType: "EmployeeProfile",
        entityId: current.id,
      });

      res.json({ profile });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new EmployeeProfileController();
