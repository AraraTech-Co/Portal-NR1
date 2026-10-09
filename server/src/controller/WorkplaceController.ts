import { Request, Response } from "express";
import prisma from "../model/prisma";
import { Establishment } from "../model/schema/Establishment/Establishment";
import { Sector } from "../model/schema/Sector/Sector";
import { JobRole } from "../model/schema/JobRole/JobRole";
import { Activity } from "../model/schema/Activity/Activity";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { isValidCnpj, normalizeCnpj } from "../helper/cnpj";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

/** CNPJ: vazio vira null; preenchido tem de ser válido e fica só com os dígitos. */
function cnpjOrNull(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null || raw.trim() === "") return null;
  if (!isValidCnpj(raw)) throw httpError(400, "CNPJ inválido — confira os números.");
  return normalizeCnpj(raw);
}

function textOrNull(raw: string | null | undefined): string | null {
  return raw && raw.trim() !== "" ? raw.trim() : null;
}

/**
 * Mudança na operação fica na trilha: o inventário depende dela, e a
 * fiscalização pergunta quem mudou o quê. [S2-N]
 */
async function audit(
  req: Request,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
) {
  const auth = req as AuthRequest;
  await writeAudit({
    organizationId: actorOrgId(auth),
    actorId: actorUserId(auth),
    action,
    entityType,
    entityId,
    before,
    after,
  });
}

class WorkplaceController {
  // —— Establishments ——
  async listEstablishments(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const rows = await new Establishment().read.all(
        { organizationId: orgId, archivedAt: null },
        {},
        { createdAt: "asc" },
      );
      res.json({ establishments: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async createEstablishment(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const { name, tax_id, address } = req.body as {
        name?: string;
        tax_id?: string;
        address?: string;
      };
      if (!name?.trim()) {
        res.status(400).json({ message: "Informe o nome." });
        return;
      }
      const row = await new Establishment().create.new({
        organizationId: orgId,
        name: name.trim(),
        taxId: cnpjOrNull(tax_id),
        address: textOrNull(address),
      });
      res.status(201).json({ establishment: row });
    } catch (err) {
      fail(res, err);
    }
  }

  async updateEstablishment(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const id = req.params.id;
      const existing = await new Establishment().read.one({
        id,
        organizationId: orgId,
      });
      if (!existing || existing.archivedAt) {
        res.status(404).json({ message: "Estabelecimento não encontrado." });
        return;
      }
      const { name, tax_id, address } = req.body as {
        name?: string;
        tax_id?: string | null;
        address?: string | null;
      };
      if (name !== undefined && !name.trim()) {
        res.status(400).json({ message: "O nome não pode ficar vazio." });
        return;
      }
      const row = await new Establishment().update.one(
        { id, organizationId: orgId },
        {
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(tax_id !== undefined ? { taxId: cnpjOrNull(tax_id) } : {}),
          ...(address !== undefined ? { address: textOrNull(address) } : {}),
        },
      );
      await audit(req, "establishment.update", "Establishment", id,
        { name: existing.name, taxId: existing.taxId, address: existing.address },
        { name: row?.name, taxId: row?.taxId, address: row?.address });
      res.json({ establishment: row });
    } catch (err) {
      fail(res, err);
    }
  }

  async archiveEstablishment(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const id = req.params.id;
      const sectors = await prisma.sector.count({
        where: { organizationId: orgId, establishmentId: id, archivedAt: null },
      });
      if (sectors > 0) {
        res.status(409).json({
          message: `Este estabelecimento ainda tem ${sectors} setor(es) ativo(s). Arquive os setores antes.`,
        });
        return;
      }
      const row = await new Establishment().update.one(
        { id, organizationId: orgId, archivedAt: null },
        { archivedAt: new Date() },
      );
      if (!row) {
        res.status(404).json({ message: "Estabelecimento não encontrado." });
        return;
      }
      await audit(req, "establishment.archive", "Establishment", id, null, { archivedAt: row.archivedAt });
      res.json({ establishment: row });
    } catch (err) {
      fail(res, err);
    }
  }

  // —— Sectors ——
  async listSectors(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const establishmentId = req.query.establishment_id as string | undefined;
      const query: Record<string, unknown> = {
        organizationId: orgId,
        archivedAt: null,
      };
      if (establishmentId) query.establishmentId = establishmentId;
      const rows = await new Sector().read.all(query, {}, { createdAt: "asc" });
      res.json({ sectors: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async createSector(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const {
        establishment_id,
        name,
        description,
        process_description,
        environment_description,
      } = req.body as Record<string, string | undefined>;
      if (!establishment_id || !name?.trim()) {
        res.status(400).json({ message: "Informe establishment_id e name." });
        return;
      }
      const est = await new Establishment().read.one({
        id: establishment_id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!est) {
        res.status(400).json({ message: "Estabelecimento inválido." });
        return;
      }
      const row = await new Sector().create.new({
        organizationId: orgId,
        establishmentId: establishment_id,
        name: name.trim(),
        description: description ?? null,
        processDescription: process_description ?? null,
        environmentDescription: environment_description ?? null,
      });
      res.status(201).json({ sector: row });
    } catch (err) {
      fail(res, err);
    }
  }

  async updateSector(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const id = req.params.id;
      const existing = await new Sector().read.one({
        id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!existing) {
        res.status(404).json({ message: "Setor não encontrado." });
        return;
      }
      const body = req.body as Record<string, string | undefined>;
      if (body.name !== undefined && !body.name.trim()) {
        res.status(400).json({ message: "O nome não pode ficar vazio." });
        return;
      }
      const row = await new Sector().update.one(
        { id, organizationId: orgId },
        {
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.description !== undefined
            ? { description: body.description }
            : {}),
          ...(body.process_description !== undefined
            ? { processDescription: body.process_description }
            : {}),
          ...(body.environment_description !== undefined
            ? { environmentDescription: body.environment_description }
            : {}),
        },
      );
      await audit(req, "sector.update", "Sector", id,
        { name: existing.name, description: existing.description },
        { name: row?.name, description: row?.description });
      res.json({ sector: row });
    } catch (err) {
      fail(res, err);
    }
  }

  async archiveSector(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const activities = await prisma.activity.count({
        where: { organizationId: orgId, sectorId: req.params.id, archivedAt: null },
      });
      if (activities > 0) {
        res.status(409).json({
          message: `Este setor ainda tem ${activities} atividade(s) ativa(s). Arquive as atividades antes.`,
        });
        return;
      }
      const row = await new Sector().update.one(
        { id: req.params.id, organizationId: orgId, archivedAt: null },
        { archivedAt: new Date() },
      );
      if (!row) {
        res.status(404).json({ message: "Setor não encontrado." });
        return;
      }
      await audit(req, "sector.archive", "Sector", row.id, null, { archivedAt: row.archivedAt });
      res.json({ sector: row });
    } catch (err) {
      fail(res, err);
    }
  }

  // —— Job roles ——
  async listJobRoles(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const sectorId = req.query.sector_id as string | undefined;
      const query: Record<string, unknown> = {
        organizationId: orgId,
        archivedAt: null,
      };
      if (sectorId) query.sectorId = sectorId;
      const rows = await new JobRole().read.all(query, {}, { createdAt: "asc" });
      res.json({ job_roles: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async createJobRole(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const { sector_id, name, description } = req.body as {
        sector_id?: string;
        name?: string;
        description?: string;
      };
      if (!sector_id || !name?.trim()) {
        res.status(400).json({ message: "Informe sector_id e name." });
        return;
      }
      const sector = await new Sector().read.one({
        id: sector_id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!sector) {
        res.status(400).json({ message: "Setor inválido." });
        return;
      }
      const row = await new JobRole().create.new({
        organizationId: orgId,
        sectorId: sector_id,
        name: name.trim(),
        description: description ?? null,
      });
      res.status(201).json({ job_role: row });
    } catch (err) {
      fail(res, err);
    }
  }

  async updateJobRole(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const existing = await new JobRole().read.one({
        id: req.params.id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!existing) {
        res.status(404).json({ message: "Função não encontrada." });
        return;
      }
      const { name, description } = req.body as {
        name?: string;
        description?: string | null;
      };
      if (name !== undefined && !name.trim()) {
        res.status(400).json({ message: "O nome não pode ficar vazio." });
        return;
      }
      const row = await new JobRole().update.one(
        { id: req.params.id, organizationId: orgId },
        {
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(description !== undefined ? { description } : {}),
        },
      );
      await audit(req, "job_role.update", "JobRole", existing.id,
        { name: existing.name, description: existing.description },
        { name: row?.name, description: row?.description });
      res.json({ job_role: row });
    } catch (err) {
      fail(res, err);
    }
  }

  async archiveJobRole(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const row = await new JobRole().update.one(
        { id: req.params.id, organizationId: orgId, archivedAt: null },
        { archivedAt: new Date() },
      );
      if (!row) {
        res.status(404).json({ message: "Função não encontrada." });
        return;
      }
      await audit(req, "job_role.archive", "JobRole", row.id, null, { archivedAt: row.archivedAt });
      res.json({ job_role: row });
    } catch (err) {
      fail(res, err);
    }
  }

  // —— Activities ——
  async listActivities(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const sectorId = req.query.sector_id as string | undefined;
      const query: Record<string, unknown> = {
        organizationId: orgId,
        archivedAt: null,
      };
      if (sectorId) query.sectorId = sectorId;
      const rows = await prisma.activity.findMany({
        where: query as never,
        include: {
          jobRoles: { include: { jobRole: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      res.json({
        activities: rows.map((a) => ({
          ...a,
          job_role_ids: a.jobRoles.map((j) => j.jobRoleId),
        })),
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async createActivity(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const { establishment_id, sector_id, name, description, job_role_ids } =
        req.body as {
          establishment_id?: string;
          sector_id?: string;
          name?: string;
          description?: string;
          job_role_ids?: string[];
        };
      if (!establishment_id || !sector_id || !name?.trim()) {
        res.status(400).json({
          message: "Informe establishment_id, sector_id e name.",
        });
        return;
      }
      // É da descrição da atividade que sai o perigo. [S1-J]
      if (!description?.trim()) {
        res.status(400).json({ message: "Descreva a atividade: o que a pessoa faz, com o quê e onde." });
        return;
      }
      const sector = await new Sector().read.one({
        id: sector_id,
        organizationId: orgId,
        establishmentId: establishment_id,
        archivedAt: null,
      });
      if (!sector) {
        res.status(400).json({ message: "Setor/estabelecimento inválidos." });
        return;
      }
      const row = await new Activity().create.new({
        organizationId: orgId,
        establishmentId: establishment_id,
        sectorId: sector_id,
        name: name.trim(),
        description: description.trim(),
      });
      if (job_role_ids?.length) {
        for (const jobRoleId of job_role_ids) {
          const jr = await new JobRole().read.one({
            id: jobRoleId,
            organizationId: orgId,
            archivedAt: null,
          });
          if (!jr) continue;
          await prisma.activityJobRole.create({
            data: { activityId: row.id, jobRoleId },
          });
        }
      }
      res.status(201).json({ activity: row });
    } catch (err) {
      fail(res, err);
    }
  }

  async updateActivity(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const existing = await new Activity().read.one({
        id: req.params.id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!existing) {
        res.status(404).json({ message: "Atividade não encontrada." });
        return;
      }
      const { name, description, job_role_ids } = req.body as {
        name?: string;
        description?: string | null;
        job_role_ids?: string[];
      };
      if (name !== undefined && !name.trim()) {
        res.status(400).json({ message: "O nome não pode ficar vazio." });
        return;
      }
      if (description !== undefined && !description?.trim()) {
        res.status(400).json({ message: "Descreva a atividade: o que a pessoa faz, com o quê e onde." });
        return;
      }
      const row = await new Activity().update.one(
        { id: req.params.id, organizationId: orgId },
        {
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(description ? { description: description.trim() } : {}),
        },
      );
      await audit(req, "activity.update", "Activity", existing.id,
        { name: existing.name, description: existing.description },
        { name: row?.name, description: row?.description, ...(job_role_ids ? { job_role_ids } : {}) });
      if (job_role_ids) {
        await prisma.activityJobRole.deleteMany({
          where: { activityId: req.params.id },
        });
        for (const jobRoleId of job_role_ids) {
          const jr = await new JobRole().read.one({
            id: jobRoleId,
            organizationId: orgId,
            archivedAt: null,
          });
          if (!jr) continue;
          await prisma.activityJobRole.create({
            data: { activityId: req.params.id, jobRoleId },
          });
        }
      }
      res.json({ activity: row });
    } catch (err) {
      fail(res, err);
    }
  }

  async archiveActivity(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const hazards = await prisma.hazard.count({
        where: { organizationId: orgId, activityId: req.params.id, archivedAt: null },
      });
      if (hazards > 0) {
        res.status(409).json({
          message: `Esta atividade tem ${hazards} perigo(s) no inventário. Arquive-os antes, para o inventário não perder a origem.`,
        });
        return;
      }
      const row = await new Activity().update.one(
        { id: req.params.id, organizationId: orgId, archivedAt: null },
        { archivedAt: new Date() },
      );
      if (!row) {
        res.status(404).json({ message: "Atividade não encontrada." });
        return;
      }
      await audit(req, "activity.archive", "Activity", row.id, null, { archivedAt: row.archivedAt });
      res.json({ activity: row });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new WorkplaceController();
