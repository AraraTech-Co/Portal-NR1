import { Request, Response } from "express";
import prisma from "../model/prisma";
import { EmergencyProcedure } from "../model/schema/EmergencyProcedure/EmergencyProcedure";
import { EmergencyDrill } from "../model/schema/EmergencyDrill/EmergencyDrill";
import { Establishment } from "../model/schema/Establishment/Establishment";
import { Evidence } from "../model/schema/Evidence/Evidence";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import {
  assertSize,
  buildEvidenceStoragePath,
  writeEvidenceFile,
} from "../helper/uploads";
import {
  EMERGENCY_DRILL_FREQUENCY_MONTHS_DEFAULT,
  EVIDENCE_TYPES,
  EVIDENCE_VALIDATION_STATUSES,
} from "../constants";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function blank(v?: string | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

class EmergencyController {
  async listProcedures(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const establishmentId = req.query.establishment_id as string | undefined;
      const includeArchived = req.query.include_archived === "true";
      const rows = await prisma.emergencyProcedure.findMany({
        where: {
          organizationId: orgId,
          ...(establishmentId ? { establishmentId } : {}),
          ...(includeArchived ? {} : { archivedAt: null }),
        },
        orderBy: { updatedAt: "desc" },
        include: {
          establishment: { select: { id: true, name: true } },
          _count: { select: { drills: true } },
          drills: {
            orderBy: { performedAt: "desc" },
            take: 1,
            select: { id: true, performedAt: true },
          },
        },
      });
      res.json({
        procedures: rows.map((p) => ({
          ...p,
          last_drill_at: p.drills[0]?.performedAt ?? null,
          drill_frequency_months:
            p.drillFrequencyMonths ?? EMERGENCY_DRILL_FREQUENCY_MONTHS_DEFAULT,
          drills: undefined,
        })),
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async getProcedure(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const procedure = await prisma.emergencyProcedure.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: {
          establishment: { select: { id: true, name: true } },
          drills: {
            orderBy: { performedAt: "desc" },
            include: {
              recordedBy: { select: { id: true, name: true } },
              _count: { select: { evidences: true } },
            },
          },
        },
      });
      if (!procedure) {
        res.status(404).json({ message: "Procedimento não encontrado." });
        return;
      }
      res.json({
        procedure: {
          ...procedure,
          drill_frequency_months:
            procedure.drillFrequencyMonths ??
            EMERGENCY_DRILL_FREQUENCY_MONTHS_DEFAULT,
        },
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async createProcedure(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const {
        establishment_id,
        scenario,
        first_aid_means,
        responsibles,
        evacuation_plan,
        large_scale_measures,
        drill_frequency_months,
      } = req.body as {
        establishment_id?: string;
        scenario?: string;
        first_aid_means?: string;
        responsibles?: string;
        evacuation_plan?: string;
        large_scale_measures?: string;
        drill_frequency_months?: number;
      };

      if (!establishment_id || !scenario?.trim()) {
        res.status(400).json({
          message: "Informe establishment_id e scenario.",
        });
        return;
      }

      // 1.5.6.2 "a": meios, responsáveis e abandono do local.
      const firstAidMeans = blank(first_aid_means);
      const responsiblesText = blank(responsibles);
      const evacuationPlan = blank(evacuation_plan);
      if (!firstAidMeans || !responsiblesText || !evacuationPlan) {
        res.status(400).json({
          message:
            "Informe first_aid_means, responsibles e evacuation_plan (NR-1 1.5.6.2 a).",
        });
        return;
      }

      const establishment = await new Establishment().read.one({
        id: establishment_id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!establishment) {
        res.status(404).json({ message: "Estabelecimento não encontrado." });
        return;
      }

      if (
        drill_frequency_months !== undefined &&
        (typeof drill_frequency_months !== "number" ||
          drill_frequency_months < 1)
      ) {
        res.status(400).json({
          message: "drill_frequency_months deve ser um inteiro ≥ 1.",
        });
        return;
      }

      const procedure = await new EmergencyProcedure().create.new({
        organizationId: orgId,
        establishmentId: establishment_id,
        scenario: scenario.trim(),
        firstAidMeans,
        responsibles: responsiblesText,
        evacuationPlan,
        largeScaleMeasures: blank(large_scale_measures),
        drillFrequencyMonths:
          drill_frequency_months ?? EMERGENCY_DRILL_FREQUENCY_MONTHS_DEFAULT,
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "emergency_procedure.create",
        entityType: "EmergencyProcedure",
        entityId: procedure.id,
        after: { scenario: procedure.scenario },
      });

      res.status(201).json({ procedure });
    } catch (err) {
      fail(res, err);
    }
  }

  async updateProcedure(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const current = await new EmergencyProcedure().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!current) {
        res.status(404).json({ message: "Procedimento não encontrado." });
        return;
      }
      if (current.archivedAt) {
        res.status(409).json({
          message: "Procedimento arquivado — reative ou crie outro.",
        });
        return;
      }

      const body = req.body as Record<string, unknown>;
      if (
        body.drill_frequency_months !== undefined &&
        (typeof body.drill_frequency_months !== "number" ||
          (body.drill_frequency_months as number) < 1)
      ) {
        res.status(400).json({
          message: "drill_frequency_months deve ser um inteiro ≥ 1.",
        });
        return;
      }

      const procedure = await new EmergencyProcedure().update.one(
        { id: current.id, organizationId: orgId },
        {
          ...(body.scenario !== undefined
            ? { scenario: String(body.scenario).trim() }
            : {}),
          ...(body.first_aid_means !== undefined
            ? { firstAidMeans: blank(body.first_aid_means as string) }
            : {}),
          ...(body.responsibles !== undefined
            ? { responsibles: blank(body.responsibles as string) }
            : {}),
          ...(body.evacuation_plan !== undefined
            ? { evacuationPlan: blank(body.evacuation_plan as string) }
            : {}),
          ...(body.large_scale_measures !== undefined
            ? { largeScaleMeasures: blank(body.large_scale_measures as string) }
            : {}),
          ...(body.drill_frequency_months !== undefined
            ? { drillFrequencyMonths: body.drill_frequency_months as number }
            : {}),
        },
      );

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "emergency_procedure.update",
        entityType: "EmergencyProcedure",
        entityId: current.id,
      });

      res.json({ procedure });
    } catch (err) {
      fail(res, err);
    }
  }

  async archiveProcedure(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const current = await new EmergencyProcedure().read.one({
        id: req.params.id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!current) {
        res.status(404).json({ message: "Procedimento não encontrado." });
        return;
      }

      const procedure = await new EmergencyProcedure().update.one(
        { id: current.id, organizationId: orgId },
        { archivedAt: new Date() },
      );

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "emergency_procedure.archive",
        entityType: "EmergencyProcedure",
        entityId: current.id,
      });

      res.json({ procedure });
    } catch (err) {
      fail(res, err);
    }
  }

  /** 1.5.6.3 / 1.5.6.3.1 — exercício simulado; evidências via addDrillEvidence. */
  async addDrill(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const procedure = await new EmergencyProcedure().read.one({
        id: req.params.id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!procedure) {
        res.status(404).json({ message: "Procedimento não encontrado." });
        return;
      }

      const { performed_at, participants, findings } = req.body as {
        performed_at?: string;
        participants?: number;
        findings?: string;
      };

      if (!performed_at) {
        res.status(400).json({ message: "Informe performed_at." });
        return;
      }

      const drill = await new EmergencyDrill().create.new({
        procedureId: procedure.id,
        performedAt: new Date(performed_at),
        participants:
          typeof participants === "number" ? participants : null,
        findings: blank(findings),
        recordedById: userId,
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "emergency_drill.create",
        entityType: "EmergencyDrill",
        entityId: drill.id,
        after: { procedureId: procedure.id },
      });

      res.status(201).json({ drill });
    } catch (err) {
      fail(res, err);
    }
  }

  async getDrill(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const drill = await prisma.emergencyDrill.findFirst({
        where: {
          id: req.params.drillId,
          procedureId: req.params.id,
          procedure: { organizationId: orgId },
        },
        include: {
          recordedBy: { select: { id: true, name: true } },
          evidences: { orderBy: { uploadedAt: "desc" } },
          procedure: {
            select: { id: true, scenario: true, establishmentId: true },
          },
        },
      });
      if (!drill) {
        res.status(404).json({ message: "Exercício não encontrado." });
        return;
      }
      res.json({ drill });
    } catch (err) {
      fail(res, err);
    }
  }

  /** 1.5.6.3.1: evidências do exercício simulado. */
  async addDrillEvidence(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const drill = await prisma.emergencyDrill.findFirst({
        where: {
          id: req.params.drillId,
          procedureId: req.params.id,
          procedure: { organizationId: orgId },
        },
      });
      if (!drill) {
        res.status(404).json({ message: "Exercício não encontrado." });
        return;
      }

      const {
        file_name,
        mime_type,
        content_base64,
        description,
        event_date,
        type,
      } = req.body as {
        file_name?: string;
        mime_type?: string;
        content_base64?: string;
        description?: string;
        event_date?: string;
        type?: string;
      };

      if (!file_name?.trim() || !mime_type) {
        res.status(400).json({ message: "Informe file_name e mime_type." });
        return;
      }

      const data = content_base64
        ? Buffer.from(content_base64, "base64")
        : Buffer.alloc(0);
      assertSize(data.length || 0);

      const { storagePath, absolutePath } = buildEvidenceStoragePath(
        orgId,
        mime_type,
      );
      writeEvidenceFile(absolutePath, data);

      const evidence = await new Evidence().create.new({
        organizationId: orgId,
        type: (type as never) || EVIDENCE_TYPES.DOCUMENT,
        storagePath,
        fileName: file_name.trim(),
        mimeType: mime_type,
        sizeBytes: data.length,
        description: blank(description),
        eventDate: event_date ? new Date(event_date) : drill.performedAt,
        uploadedById: userId,
        drillId: drill.id,
        validationStatus: EVIDENCE_VALIDATION_STATUSES.PENDING,
      });

      res.status(201).json({ evidence });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new EmergencyController();
