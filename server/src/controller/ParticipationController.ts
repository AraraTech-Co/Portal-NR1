import { Request, Response } from "express";
import prisma from "../model/prisma";
import { ParticipationRecord } from "../model/schema/ParticipationRecord/ParticipationRecord";
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
  EVIDENCE_TYPES,
  EVIDENCE_VALIDATION_STATUSES,
  PARTICIPATION_TYPE_VALUES,
  isParticipationType,
} from "../constants";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function blank(v?: string | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

class ParticipationController {
  async list(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const establishmentId = req.query.establishment_id as string | undefined;
      const type = req.query.type as string | undefined;

      const rows = await prisma.participationRecord.findMany({
        where: {
          organizationId: orgId,
          ...(establishmentId ? { establishmentId } : {}),
          ...(type && isParticipationType(type) ? { type } : {}),
        },
        orderBy: { occurredAt: "desc" },
        include: {
          establishment: { select: { id: true, name: true } },
          recordedBy: { select: { id: true, name: true } },
          _count: { select: { evidences: true } },
        },
      });
      res.json({ participations: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async get(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const participation = await prisma.participationRecord.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: {
          establishment: { select: { id: true, name: true } },
          recordedBy: { select: { id: true, name: true } },
          evidences: { orderBy: { uploadedAt: "desc" } },
        },
      });
      if (!participation) {
        res.status(404).json({ message: "Registro de participação não encontrado." });
        return;
      }
      res.json({ participation });
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
        subject,
        description,
        occurred_at,
        establishment_id,
        participants_count,
      } = req.body as {
        type?: string;
        subject?: string;
        description?: string;
        occurred_at?: string;
        establishment_id?: string;
        participants_count?: number;
      };

      if (!type || !subject?.trim() || !occurred_at) {
        res.status(400).json({
          message: "Informe type, subject e occurred_at.",
        });
        return;
      }
      if (!isParticipationType(type)) {
        res.status(400).json({
          message: `type inválido. Use: ${PARTICIPATION_TYPE_VALUES.join(", ")}.`,
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

      if (
        participants_count !== undefined &&
        (typeof participants_count !== "number" || participants_count < 0)
      ) {
        res.status(400).json({
          message: "participants_count deve ser um número ≥ 0.",
        });
        return;
      }

      const participation = await new ParticipationRecord().create.new({
        organizationId: orgId,
        type,
        subject: subject.trim(),
        description: blank(description),
        occurredAt: new Date(occurred_at),
        establishmentId: establishment_id ?? null,
        participantsCount:
          typeof participants_count === "number" ? participants_count : null,
        recordedById: userId,
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "participation.create",
        entityType: "ParticipationRecord",
        entityId: participation.id,
        after: { type: participation.type, subject: participation.subject },
      });

      res.status(201).json({ participation });
    } catch (err) {
      fail(res, err);
    }
  }

  async update(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const current = await new ParticipationRecord().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!current) {
        res.status(404).json({
          message: "Registro de participação não encontrado.",
        });
        return;
      }

      const body = req.body as Record<string, unknown>;

      if (body.type !== undefined && !isParticipationType(String(body.type))) {
        res.status(400).json({
          message: `type inválido. Use: ${PARTICIPATION_TYPE_VALUES.join(", ")}.`,
        });
        return;
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

      if (
        body.participants_count !== undefined &&
        body.participants_count !== null &&
        (typeof body.participants_count !== "number" ||
          (body.participants_count as number) < 0)
      ) {
        res.status(400).json({
          message: "participants_count deve ser um número ≥ 0.",
        });
        return;
      }

      const participation = await new ParticipationRecord().update.one(
        { id: current.id, organizationId: orgId },
        {
          ...(body.type !== undefined ? { type: body.type as never } : {}),
          ...(body.subject !== undefined
            ? { subject: String(body.subject).trim() }
            : {}),
          ...(body.description !== undefined
            ? { description: blank(body.description as string) }
            : {}),
          ...(body.occurred_at !== undefined
            ? { occurredAt: new Date(String(body.occurred_at)) }
            : {}),
          ...(body.establishment_id !== undefined
            ? { establishmentId: (body.establishment_id as string) || null }
            : {}),
          ...(body.participants_count !== undefined
            ? {
                participantsCount:
                  body.participants_count === null
                    ? null
                    : (body.participants_count as number),
              }
            : {}),
        },
      );

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "participation.update",
        entityType: "ParticipationRecord",
        entityId: current.id,
      });

      res.json({ participation });
    } catch (err) {
      fail(res, err);
    }
  }

  /** Evidência de que a participação de fato ocorreu (lista, ata, foto, etc.). */
  async addEvidence(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const participation = await new ParticipationRecord().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!participation) {
        res.status(404).json({
          message: "Registro de participação não encontrado.",
        });
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
        eventDate: event_date
          ? new Date(event_date)
          : participation.occurredAt,
        uploadedById: userId,
        participationId: participation.id,
        validationStatus: EVIDENCE_VALIDATION_STATUSES.PENDING,
      });

      res.status(201).json({ evidence });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new ParticipationController();
