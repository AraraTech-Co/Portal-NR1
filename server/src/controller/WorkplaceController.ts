import { Request, Response } from "express";
import prisma from "../model/prisma";
import { Establishment } from "../model/schema/Establishment/Establishment";
import { Sector } from "../model/schema/Sector/Sector";
import { JobRole } from "../model/schema/JobRole/JobRole";
import { Activity } from "../model/schema/Activity/Activity";
import { actorOrgId } from "../helper/org-scope";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
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
        taxId: tax_id ?? null,
        address: address ?? null,
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
      const row = await new Establishment().update.one(
        { id, organizationId: orgId },
        {
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(tax_id !== undefined ? { taxId: tax_id } : {}),
          ...(address !== undefined ? { address } : {}),
        },
      );
      res.json({ establishment: row });
    } catch (err) {
      fail(res, err);
    }
  }

  async archiveEstablishment(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const id = req.params.id;
      const row = await new Establishment().update.one(
        { id, organizationId: orgId, archivedAt: null },
        { archivedAt: new Date() },
      );
      if (!row) {
        res.status(404).json({ message: "Estabelecimento não encontrado." });
        return;
      }
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
      res.json({ sector: row });
    } catch (err) {
      fail(res, err);
    }
  }

  async archiveSector(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const row = await new Sector().update.one(
        { id: req.params.id, organizationId: orgId, archivedAt: null },
        { archivedAt: new Date() },
      );
      if (!row) {
        res.status(404).json({ message: "Setor não encontrado." });
        return;
      }
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
      const row = await new JobRole().update.one(
        { id: req.params.id, organizationId: orgId },
        {
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(description !== undefined ? { description } : {}),
        },
      );
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
        description: description ?? null,
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
      const row = await new Activity().update.one(
        { id: req.params.id, organizationId: orgId },
        {
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(description !== undefined ? { description } : {}),
        },
      );
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
      const row = await new Activity().update.one(
        { id: req.params.id, organizationId: orgId, archivedAt: null },
        { archivedAt: new Date() },
      );
      if (!row) {
        res.status(404).json({ message: "Atividade não encontrada." });
        return;
      }
      res.json({ activity: row });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new WorkplaceController();
