import { AssessmentStatus, PgrDocumentType } from "@prisma/client";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { Establishment } from "../model/schema/Establishment/Establishment";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { REQUIRED_PGR_DOCUMENTS } from "../helper/compliance";
import { writeAudit } from "../helper/audit";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

const DEFAULT_SIGNATURE =
  "Declaro, sob minha responsabilidade, que o conteúdo deste documento reflete o estado do gerenciamento de riscos ocupacionais na data da emissão.";

async function buildInventorySnapshot(
  organizationId: string,
  establishmentId?: string | null,
) {
  const hazards = await prisma.hazard.findMany({
    where: {
      organizationId,
      archivedAt: null,
      ...(establishmentId
        ? { activity: { establishmentId } }
        : {}),
    },
    include: {
      activity: {
        include: { sector: true, establishment: true },
      },
      risks: {
        where: { archivedAt: null },
        include: {
          assessments: {
            where: { status: AssessmentStatus.VALIDATED },
            orderBy: { validatedAt: "desc" },
            take: 1,
          },
          controls: { where: { archivedAt: null } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    generated_at: new Date().toISOString(),
    items: hazards.map((h) => ({
      hazard_id: h.id,
      description: h.description,
      source: h.source,
      consequences: h.consequences,
      exposed_group: h.exposedGroup,
      exposed_workers_count: h.exposedWorkersCount,
      exposure_time: h.exposureTime,
      exposure_frequency: h.exposureFrequency,
      exposure_intensity: h.exposureIntensity,
      monitoring_data: h.monitoringData,
      category: h.category,
      activity: h.activity.name,
      sector: h.activity.sector.name,
      establishment: h.activity.establishment.name,
      risks: h.risks.map((r) => ({
        risk_id: r.id,
        description: r.description,
        needs_reassessment: r.needsReassessment,
        level: r.assessments[0]?.resultingLevel ?? null,
        severity: r.assessments[0]?.severity ?? null,
        probability: r.assessments[0]?.probability ?? null,
        controls: r.controls.map((c) => ({
          id: c.id,
          type: c.type,
          description: c.description,
          status: c.status,
        })),
      })),
    })),
  };
}

async function buildActionPlanSnapshot(
  organizationId: string,
  establishmentId?: string | null,
) {
  const actions = await prisma.action.findMany({
    where: {
      organizationId,
      ...(establishmentId
        ? {
            OR: [
              { risk: { hazard: { activity: { establishmentId } } } },
              { riskId: null },
            ],
          }
        : {}),
    },
    include: {
      risk: true,
      control: true,
      evidences: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    generated_at: new Date().toISOString(),
    actions: actions.map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      status: a.status,
      priority: a.priority,
      due_date: a.dueDate,
      effectiveness_criteria: a.effectivenessCriteria,
      effectiveness_result: a.effectivenessResult,
      risk_id: a.riskId,
      control_id: a.controlId,
      evidence_count: a.evidences.length,
    })),
  };
}

async function buildCriteriaSnapshot(organizationId: string) {
  const methodologies = await prisma.riskMethodology.findMany({
    where: {
      archivedAt: null,
      OR: [{ organizationId: null }, { organizationId }],
    },
    include: {
      versions: { orderBy: { version: "desc" }, take: 1 },
    },
  });

  return {
    generated_at: new Date().toISOString(),
    note: "Critérios de severidade, probabilidade, níveis e matriz (1.5.4.4.2.2).",
    methodologies: methodologies.map((m) => ({
      id: m.id,
      name: m.name,
      is_default: m.isDefault,
      version: m.versions[0]
        ? {
            id: m.versions[0].id,
            version: m.versions[0].version,
            severity_scale: m.versions[0].severityScale,
            probability_scale: m.versions[0].probabilityScale,
            matrix: m.versions[0].matrix,
            levels: m.versions[0].levels,
          }
        : null,
    })),
  };
}

class DocumentController {
  /** Inventário vivo (projeção) — não é documento assinado. */
  async getInventory(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const establishmentId = req.query.establishment_id as string | undefined;
      const snapshot = await buildInventorySnapshot(orgId, establishmentId);
      res.json({ inventory: snapshot });
    } catch (err) {
      fail(res, err);
    }
  }

  async listDocuments(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const type = req.query.type as string | undefined;
      const rows = await prisma.pgrDocument.findMany({
        where: {
          organizationId: orgId,
          ...(type ? { type: type as PgrDocumentType } : {}),
        },
        orderBy: [{ type: "asc" }, { version: "desc" }],
      });
      res.json({
        documents: rows,
        required_types: REQUIRED_PGR_DOCUMENTS,
      });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Emite documento PGR append-only (BR-22/23).
   * type: INVENTORY | ACTION_PLAN | CRITERIA
   */
  async issueDocument(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const {
        type,
        establishment_id,
        responsible_name,
        responsible_role,
        responsible_registration,
        signature_statement,
      } = req.body as {
        type?: string;
        establishment_id?: string | null;
        responsible_name?: string;
        responsible_role?: string;
        responsible_registration?: string;
        signature_statement?: string;
      };

      if (!type || !REQUIRED_PGR_DOCUMENTS.includes(type as never)) {
        res.status(400).json({
          message: `type deve ser um de: ${REQUIRED_PGR_DOCUMENTS.join(", ")}`,
        });
        return;
      }

      const org = await prisma.organization.findFirst({ where: { id: orgId } });
      if (!org) {
        res.status(404).json({ message: "Organização não encontrada." });
        return;
      }

      const responsibleName =
        responsible_name?.trim() || org.responsibleName || null;
      if (!responsibleName) {
        res.status(400).json({
          message:
            "Informe responsible_name (ou cadastre o responsável na organização).",
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

      let content: unknown;
      if (type === "INVENTORY") {
        content = await buildInventorySnapshot(orgId, establishment_id);
      } else if (type === "ACTION_PLAN") {
        content = await buildActionPlanSnapshot(orgId, establishment_id);
      } else {
        content = await buildCriteriaSnapshot(orgId);
      }

      const last = await prisma.pgrDocument.findFirst({
        where: {
          organizationId: orgId,
          type: type as PgrDocumentType,
          establishmentId: establishment_id ?? null,
        },
        orderBy: { version: "desc" },
      });
      const version = (last?.version ?? 0) + 1;

      const doc = await prisma.pgrDocument.create({
        data: {
          organizationId: orgId,
          establishmentId: establishment_id ?? null,
          type: type as PgrDocumentType,
          version,
          content: content as never,
          issuedById: userId,
          responsibleName,
          responsibleRole:
            responsible_role ?? org.responsibleRole ?? null,
          responsibleRegistration:
            responsible_registration ?? org.responsibleRegistration ?? null,
          signatureStatement:
            signature_statement?.trim() || DEFAULT_SIGNATURE,
        },
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "pgr_document.issue",
        entityType: "PgrDocument",
        entityId: doc.id,
        after: { type: doc.type, version: doc.version },
      });

      res.status(201).json({ document: doc });
    } catch (err) {
      fail(res, err);
    }
  }

  // —— Change events ——
  async listChangeEvents(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const rows = await prisma.changeEvent.findMany({
        where: { organizationId: orgId },
        orderBy: { occurredAt: "desc" },
      });
      res.json({ change_events: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async createChangeEvent(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const {
        type,
        description,
        establishment_id,
        occurred_at,
        flag_risk_ids,
      } = req.body as {
        type?: string;
        description?: string;
        establishment_id?: string;
        occurred_at?: string;
        flag_risk_ids?: string[];
      };

      if (!type || !description?.trim()) {
        res.status(400).json({ message: "Informe type e description." });
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

      const event = await prisma.$transaction(async (tx) => {
        const created = await tx.changeEvent.create({
          data: {
            organizationId: orgId,
            establishmentId: establishment_id ?? null,
            type: type as never,
            description: description.trim(),
            occurredAt: occurred_at ? new Date(occurred_at) : new Date(),
            reportedById: userId,
          },
        });

        if (flag_risk_ids?.length) {
          await tx.risk.updateMany({
            where: {
              id: { in: flag_risk_ids },
              organizationId: orgId,
              archivedAt: null,
            },
            data: {
              needsReassessment: true,
              reassessmentReason: `Mudança registrada: ${created.description}`,
            },
          });
        }

        await tx.auditEvent.create({
          data: {
            organizationId: orgId,
            actorId: userId,
            action: "change_event.create",
            entityType: "ChangeEvent",
            entityId: created.id,
            after: { type: created.type, flag_risk_ids: flag_risk_ids ?? [] },
          },
        });

        return created;
      });

      res.status(201).json({ change_event: event });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new DocumentController();
