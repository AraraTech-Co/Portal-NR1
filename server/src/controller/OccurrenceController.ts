import { Request, Response } from "express";
import prisma from "../model/prisma";
import { Occurrence } from "../model/schema/Occurrence/Occurrence";
import { Establishment } from "../model/schema/Establishment/Establishment";
import { Risk } from "../model/schema/Risk/Risk";
import { Action } from "../model/schema/Action/Action";
import { Evidence } from "../model/schema/Evidence/Evidence";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { canManageModule } from "../helper/module-access";
import {
  assertSize,
  buildEvidenceStoragePath,
  writeEvidenceFile,
} from "../helper/uploads";
import {
  ACTION_PRIORITIES,
  ACTION_SOURCE_TYPES,
  ACTION_STATUSES,
  EVIDENCE_TYPES,
  EVIDENCE_VALIDATION_STATUSES,
  OCCURRENCE_TYPE_VALUES,
  isOccurrenceType,
} from "../constants";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function blank(v?: string | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

/**
 * Quem tem escrita sem administrar o módulo (o colaborador) mexe só na
 * ocorrência que ele registrou. [S4-A]
 */
function ownsOrManages(req: AuthRequest, reportedById: string | null): boolean {
  if (req.actor && canManageModule(req.actor.permission, "ocorrencias")) return true;
  return reportedById === actorUserId(req);
}

class OccurrenceController {
  async list(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const establishmentId = req.query.establishment_id as string | undefined;
      const type = req.query.type as string | undefined;
      const rows = await prisma.occurrence.findMany({
        where: {
          organizationId: orgId,
          ...(establishmentId ? { establishmentId } : {}),
          ...(type && isOccurrenceType(type) ? { type } : {}),
        },
        orderBy: { occurredAt: "desc" },
        include: {
          establishment: { select: { id: true, name: true } },
          risk: { select: { id: true, description: true } },
          reportedBy: { select: { id: true, name: true } },
          analyzedBy: { select: { id: true, name: true } },
          _count: { select: { actions: true, evidences: true } },
        },
      });
      res.json({ occurrences: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async get(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const occurrence = await prisma.occurrence.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: {
          establishment: { select: { id: true, name: true } },
          risk: {
            select: {
              id: true,
              description: true,
              hazard: { select: { id: true, description: true } },
            },
          },
          reportedBy: { select: { id: true, name: true } },
          analyzedBy: { select: { id: true, name: true } },
          actions: { orderBy: { createdAt: "desc" } },
          evidences: { orderBy: { uploadedAt: "desc" } },
        },
      });
      if (!occurrence) {
        res.status(404).json({ message: "Ocorrência não encontrada." });
        return;
      }
      res.json({ occurrence });
    } catch (err) {
      fail(res, err);
    }
  }

  async create(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const {
        type,
        description,
        occurred_at,
        establishment_id,
        risk_id,
        generating_situation,
        organizational_data,
        prevention_review,
      } = req.body as {
        type?: string;
        description?: string;
        occurred_at?: string;
        establishment_id?: string;
        risk_id?: string;
        generating_situation?: string;
        organizational_data?: string;
        prevention_review?: string;
      };

      if (!type || !description?.trim() || !occurred_at) {
        res.status(400).json({
          message: "Informe type, description e occurred_at.",
        });
        return;
      }
      if (!isOccurrenceType(type)) {
        res.status(400).json({
          message: `type inválido. Use: ${OCCURRENCE_TYPE_VALUES.join(", ")}.`,
        });
        return;
      }

      if (establishment_id) {
        const est = await new Establishment().read.one({
          id: establishment_id,
          organizationId: orgId,
          archivedAt: null,
        });
        if (!est) {
          res.status(400).json({ message: "Estabelecimento inválido." });
          return;
        }
      }

      if (risk_id) {
        const risk = await new Risk().read.one({
          id: risk_id,
          organizationId: orgId,
          archivedAt: null,
        });
        if (!risk) {
          res.status(400).json({ message: "Risco inválido." });
          return;
        }
      }

      const occurrence = await new Occurrence().create.new({
        organizationId: orgId,
        type,
        description: description.trim(),
        occurredAt: new Date(occurred_at),
        establishmentId: establishment_id ?? null,
        riskId: risk_id ?? null,
        generatingSituation: blank(generating_situation),
        organizationalData: blank(organizational_data),
        preventionReview: blank(prevention_review),
        reportedById: userId,
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "occurrence.create",
        entityType: "Occurrence",
        entityId: occurrence.id,
        after: { type: occurrence.type },
      });

      res.status(201).json({ occurrence });
    } catch (err) {
      fail(res, err);
    }
  }

  async update(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const current = await new Occurrence().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!current) {
        res.status(404).json({ message: "Ocorrência não encontrada." });
        return;
      }
      if (!ownsOrManages(req as AuthRequest, current.reportedById)) {
        res.status(403).json({ message: "Só quem registrou a ocorrência pode editá-la." });
        return;
      }

      const body = req.body as Record<string, unknown>;

      if (body.type !== undefined) {
        if (!isOccurrenceType(String(body.type))) {
          res.status(400).json({
            message: `type inválido. Use: ${OCCURRENCE_TYPE_VALUES.join(", ")}.`,
          });
          return;
        }
      }

      if (body.establishment_id) {
        const est = await new Establishment().read.one({
          id: body.establishment_id as string,
          organizationId: orgId,
          archivedAt: null,
        });
        if (!est) {
          res.status(400).json({ message: "Estabelecimento inválido." });
          return;
        }
      }

      if (body.risk_id) {
        const risk = await new Risk().read.one({
          id: body.risk_id as string,
          organizationId: orgId,
          archivedAt: null,
        });
        if (!risk) {
          res.status(400).json({ message: "Risco inválido." });
          return;
        }
      }

      const occurrence = await new Occurrence().update.one(
        { id: current.id, organizationId: orgId },
        {
          ...(body.type !== undefined ? { type: body.type as never } : {}),
          ...(body.description !== undefined
            ? { description: String(body.description).trim() }
            : {}),
          ...(body.occurred_at !== undefined
            ? { occurredAt: new Date(String(body.occurred_at)) }
            : {}),
          ...(body.establishment_id !== undefined
            ? { establishmentId: (body.establishment_id as string) || null }
            : {}),
          ...(body.risk_id !== undefined
            ? { riskId: (body.risk_id as string) || null }
            : {}),
          ...(body.generating_situation !== undefined
            ? { generatingSituation: blank(body.generating_situation as string) }
            : {}),
          ...(body.organizational_data !== undefined
            ? { organizationalData: blank(body.organizational_data as string) }
            : {}),
          ...(body.prevention_review !== undefined
            ? { preventionReview: blank(body.prevention_review as string) }
            : {}),
        },
      );

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "occurrence.update",
        entityType: "Occurrence",
        entityId: current.id,
      });

      res.json({ occurrence });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Registra a análise exigida pela NR-1 1.5.5.5.2:
   * (a) situações geradoras, (b) dados organizacionais/epidemiológicos,
   * (c) evidências para revisar medidas de prevenção.
   */
  async analyze(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const current = await new Occurrence().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!current) {
        res.status(404).json({ message: "Ocorrência não encontrada." });
        return;
      }

      const {
        generating_situation,
        organizational_data,
        prevention_review,
      } = req.body as {
        generating_situation?: string;
        organizational_data?: string;
        prevention_review?: string;
      };

      const generatingSituation =
        blank(generating_situation) ?? current.generatingSituation;
      const organizationalData =
        blank(organizational_data) ?? current.organizationalData;
      const preventionReview =
        blank(prevention_review) ?? current.preventionReview;

      if (!generatingSituation || !organizationalData || !preventionReview) {
        res.status(400).json({
          message:
            "Análise exige generating_situation, organizational_data e prevention_review (NR-1 1.5.5.5.2).",
        });
        return;
      }

      const occurrence = await new Occurrence().update.one(
        { id: current.id, organizationId: orgId },
        {
          generatingSituation,
          organizationalData,
          preventionReview,
          analyzedById: userId,
          analyzedAt: new Date(),
        },
      );

      // Marca risco vinculado para reassessment quando a análise aponta revisão.
      if (current.riskId) {
        await prisma.risk.updateMany({
          where: { id: current.riskId, organizationId: orgId },
          data: {
            needsReassessment: true,
            reassessmentReason: `Ocorrência ${current.id} analisada — revisar medidas (1.5.5.5.2 c).`,
          },
        });
      }

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "occurrence.analyze",
        entityType: "Occurrence",
        entityId: current.id,
      });

      res.json({ occurrence });
    } catch (err) {
      fail(res, err);
    }
  }

  async addAction(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const occurrence = await new Occurrence().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!occurrence) {
        res.status(404).json({ message: "Ocorrência não encontrada." });
        return;
      }

      const {
        title,
        description,
        priority,
        assignee_id,
        due_date,
        effectiveness_criteria,
      } = req.body as {
        title?: string;
        description?: string;
        priority?: string;
        assignee_id?: string;
        due_date?: string;
        effectiveness_criteria?: string;
      };

      if (!title?.trim()) {
        res.status(400).json({ message: "Informe o título da ação." });
        return;
      }

      const action = await new Action().create.new({
        organizationId: orgId,
        title: title.trim(),
        description: blank(description),
        sourceType: ACTION_SOURCE_TYPES.OCCURRENCE,
        occurrenceId: occurrence.id,
        riskId: occurrence.riskId,
        priority: (priority as never) || ACTION_PRIORITIES.HIGH,
        status: ACTION_STATUSES.OPEN,
        assigneeId: assignee_id ?? null,
        dueDate: due_date ? new Date(due_date) : null,
        effectivenessCriteria: blank(effectiveness_criteria),
        createdById: userId,
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "occurrence.add_action",
        entityType: "Action",
        entityId: action.id,
        after: { occurrenceId: occurrence.id },
      });

      res.status(201).json({ action });
    } catch (err) {
      fail(res, err);
    }
  }

  async addEvidence(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const occurrence = await new Occurrence().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!occurrence) {
        res.status(404).json({ message: "Ocorrência não encontrada." });
        return;
      }
      if (!ownsOrManages(req as AuthRequest, occurrence.reportedById)) {
        res.status(403).json({ message: "Só quem registrou a ocorrência anexa evidência." });
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
        eventDate: event_date ? new Date(event_date) : null,
        uploadedById: userId,
        occurrenceId: occurrence.id,
        validationStatus: EVIDENCE_VALIDATION_STATUSES.PENDING,
      });

      res.status(201).json({ evidence });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new OccurrenceController();
