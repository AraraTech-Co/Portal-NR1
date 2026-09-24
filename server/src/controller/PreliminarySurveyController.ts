import {
  HazardCategory,
  HazardOrigin,
  HazardStatus,
  SurveyOutcome,
  SurveyTrigger,
} from "@prisma/client";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { PreliminarySurvey } from "../model/schema/PreliminarySurvey/PreliminarySurvey";
import { Establishment } from "../model/schema/Establishment/Establishment";
import { Activity } from "../model/schema/Activity/Activity";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function blank(v?: string | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

const TRIGGERS = new Set<string>(Object.values(SurveyTrigger));
const OUTCOMES = new Set<string>(Object.values(SurveyOutcome));

class PreliminarySurveyController {
  async list(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const establishmentId = req.query.establishment_id as string | undefined;
      const rows = await prisma.preliminarySurvey.findMany({
        where: {
          organizationId: orgId,
          ...(establishmentId ? { establishmentId } : {}),
        },
        orderBy: { conductedAt: "desc" },
        include: {
          establishment: { select: { id: true, name: true } },
          conductedBy: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
      });
      res.json({ surveys: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async get(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const survey = await prisma.preliminarySurvey.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: {
          establishment: { select: { id: true, name: true } },
          conductedBy: { select: { id: true, name: true } },
          items: {
            orderBy: { createdAt: "asc" },
            include: {
              activity: { select: { id: true, name: true } },
            },
          },
        },
      });
      if (!survey) {
        res.status(404).json({ message: "Levantamento não encontrado." });
        return;
      }
      res.json({ survey });
    } catch (err) {
      fail(res, err);
    }
  }

  async create(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const {
        establishment_id,
        trigger,
        description,
        conducted_at,
      } = req.body as {
        establishment_id?: string;
        trigger?: string;
        description?: string;
        conducted_at?: string;
      };

      if (!establishment_id || !trigger) {
        res.status(400).json({
          message: "Informe establishment_id e trigger.",
        });
        return;
      }
      if (!TRIGGERS.has(trigger)) {
        res.status(400).json({
          message: `trigger inválido. Use: ${[...TRIGGERS].join(", ")}.`,
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

      const survey = await new PreliminarySurvey().create.new({
        organizationId: orgId,
        establishmentId: establishment_id,
        trigger: trigger as SurveyTrigger,
        description: blank(description),
        conductedById: userId,
        conductedAt: conducted_at ? new Date(conducted_at) : new Date(),
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "preliminary_survey.create",
        entityType: "PreliminarySurvey",
        entityId: survey.id,
        after: { trigger: survey.trigger },
      });

      res.status(201).json({ survey });
    } catch (err) {
      fail(res, err);
    }
  }

  async addItem(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const survey = await new PreliminarySurvey().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!survey) {
        res.status(404).json({ message: "Levantamento não encontrado." });
        return;
      }

      const {
        description,
        outcome,
        measure_taken,
        activity_id,
        category,
      } = req.body as {
        description?: string;
        outcome?: string;
        measure_taken?: string;
        activity_id?: string;
        category?: string;
      };

      if (!description?.trim() || !outcome) {
        res.status(400).json({
          message: "Informe description e outcome.",
        });
        return;
      }
      if (!OUTCOMES.has(outcome)) {
        res.status(400).json({
          message: `outcome inválido. Use: ${[...OUTCOMES].join(", ")}.`,
        });
        return;
      }

      const measureTaken = blank(measure_taken);
      const surveyOutcome = outcome as SurveyOutcome;

      // 1.5.4.2.1.1 "b": risco evidente com medida imediata — exige registrar a medida.
      if (surveyOutcome === SurveyOutcome.IMMEDIATE_MEASURE && !measureTaken) {
        res.status(400).json({
          message:
            "Outcome IMMEDIATE_MEASURE exige measure_taken (NR-1 1.5.4.2.1.1).",
        });
        return;
      }

      const needsActivity =
        surveyOutcome === SurveyOutcome.DEFERRED_TO_ACTION_PLAN ||
        surveyOutcome === SurveyOutcome.ESCALATED_TO_ASSESSMENT;

      let activityId: string | null = activity_id ?? null;
      if (needsActivity) {
        if (!activityId) {
          res.status(400).json({
            message:
              "Outcomes DEFERRED_TO_ACTION_PLAN e ESCALATED_TO_ASSESSMENT exigem activity_id.",
          });
          return;
        }
        const activity = await new Activity().read.one({
          id: activityId,
          organizationId: orgId,
          establishmentId: survey.establishmentId,
          archivedAt: null,
        });
        if (!activity) {
          res.status(400).json({
            message: "Atividade inválida neste estabelecimento.",
          });
          return;
        }
      } else if (activityId) {
        const activity = await new Activity().read.one({
          id: activityId,
          organizationId: orgId,
          establishmentId: survey.establishmentId,
          archivedAt: null,
        });
        if (!activity) {
          res.status(400).json({
            message: "Atividade inválida neste estabelecimento.",
          });
          return;
        }
      }

      const result = await prisma.$transaction(async (tx) => {
        const item = await tx.preliminarySurveyItem.create({
          data: {
            surveyId: survey.id,
            activityId,
            description: description.trim(),
            outcome: surveyOutcome,
            measureTaken,
          },
        });

        let hazard = null;
        let action = null;

        // 1.5.4.2.1.3: sem medida imediata → plano de ação + inventário (Hazard).
        if (surveyOutcome === SurveyOutcome.DEFERRED_TO_ACTION_PLAN) {
          hazard = await tx.hazard.create({
            data: {
              organizationId: orgId,
              activityId: activityId!,
              description: description.trim(),
              source: `Levantamento preliminar ${survey.id}`,
              category: (category as HazardCategory) || HazardCategory.ACCIDENT,
              origin: HazardOrigin.ROUTINE_REVIEW,
              status: HazardStatus.IDENTIFIED,
              monitoringData: `Preliminar · deferred · item ${item.id}`,
              createdById: userId,
            },
          });
          action = await tx.action.create({
            data: {
              organizationId: orgId,
              title: `Medida diferida: ${description.trim().slice(0, 120)}`,
              description:
                `Origem: levantamento preliminar (NR-1 1.5.4.2.1.3).\n` +
                `Item: ${item.id}\n` +
                `Perigo: ${hazard.id}`,
              sourceType: "MANUAL",
              priority: "HIGH",
              createdById: userId,
            },
          });
        }

        // 1.5.4.2.1.2: segue identificação/avaliação completa → Hazard no inventário.
        if (surveyOutcome === SurveyOutcome.ESCALATED_TO_ASSESSMENT) {
          hazard = await tx.hazard.create({
            data: {
              organizationId: orgId,
              activityId: activityId!,
              description: description.trim(),
              source: `Levantamento preliminar ${survey.id}`,
              category: (category as HazardCategory) || HazardCategory.ACCIDENT,
              origin: HazardOrigin.ROUTINE_REVIEW,
              status: HazardStatus.IDENTIFIED,
              monitoringData: `Preliminar · escalated · item ${item.id}`,
              createdById: userId,
            },
          });
        }

        return { item, hazard, action };
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "preliminary_survey.add_item",
        entityType: "PreliminarySurveyItem",
        entityId: result.item.id,
        after: {
          outcome: surveyOutcome,
          hazardId: result.hazard?.id ?? null,
          actionId: result.action?.id ?? null,
        },
      });

      res.status(201).json({
        item: result.item,
        hazard: result.hazard,
        action: result.action,
      });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new PreliminarySurveyController();
