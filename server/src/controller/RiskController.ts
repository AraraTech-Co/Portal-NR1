import { AssessmentStatus, ControlStatus, ControlType } from "@prisma/client";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { Activity } from "../model/schema/Activity/Activity";
import { Hazard } from "../model/schema/Hazard/Hazard";
import { Risk } from "../model/schema/Risk/Risk";
import { RiskAssessment } from "../model/schema/RiskAssessment/RiskAssessment";
import { ControlMeasure } from "../model/schema/ControlMeasure/ControlMeasure";
import { Action } from "../model/schema/Action/Action";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { resolveLevel } from "../helper/risk-methodology";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

/** Mudança no inventário fica na trilha, para o histórico do risco. [S2-N] */
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

function textOrNull(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

class RiskController {
  // —— Methodologies ——
  async listMethodologies(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const rows = await prisma.riskMethodology.findMany({
        where: {
          archivedAt: null,
          OR: [{ organizationId: null }, { organizationId: orgId }],
        },
        include: {
          versions: { orderBy: { version: "desc" }, take: 1 },
        },
        orderBy: { name: "asc" },
      });
      res.json({ methodologies: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  // —— Hazards ——
  async listHazards(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const activityId = req.query.activity_id as string | undefined;
      const where: Record<string, unknown> = {
        organizationId: orgId,
        archivedAt: null,
      };
      if (activityId) where.activityId = activityId;
      const rows = await new Hazard().read.all(where, {}, { createdAt: "desc" });
      res.json({ hazards: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async createHazard(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const body = req.body as Record<string, unknown>;
      const activityId = body.activity_id as string | undefined;
      const description = body.description as string | undefined;
      if (!activityId || !description?.trim()) {
        res.status(400).json({ message: "Informe activity_id e description." });
        return;
      }
      const activity = await new Activity().read.one({
        id: activityId,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!activity) {
        res.status(400).json({ message: "Atividade inválida." });
        return;
      }
      const row = await new Hazard().create.new({
        organizationId: orgId,
        activityId,
        description: description.trim(),
        source: (body.source as string) ?? null,
        consequences: (body.consequences as string) ?? null,
        exposedGroup: (body.exposed_group as string) ?? null,
        exposedWorkersCount: (body.exposed_workers_count as number) ?? null,
        exposureTime: (body.exposure_time as string) ?? null,
        exposureFrequency: (body.exposure_frequency as string) ?? null,
        exposureIntensity: (body.exposure_intensity as string) ?? null,
        monitoringData: textOrNull(body.monitoring_data),
        category: (body.category as never) ?? "ACCIDENT",
        origin: (body.origin as never) ?? "ROUTINE_REVIEW",
        createdById: userId,
      });
      await audit(req, "hazard.create", "Hazard", row.id, null, {
        description: row.description,
        category: row.category,
        activityId,
      });
      res.status(201).json({ hazard: row });
    } catch (err) {
      fail(res, err);
    }
  }

  async updateHazard(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const existing = await new Hazard().read.one({
        id: req.params.id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!existing) {
        res.status(404).json({ message: "Perigo não encontrado." });
        return;
      }
      const body = req.body as Record<string, unknown>;
      if (body.description !== undefined && !String(body.description).trim()) {
        res.status(400).json({ message: "A descrição do perigo não pode ficar vazia." });
        return;
      }
      const row = await new Hazard().update.one(
        { id: req.params.id, organizationId: orgId },
        {
          ...(body.description !== undefined
            ? { description: String(body.description).trim() }
            : {}),
          ...(body.source !== undefined ? { source: body.source } : {}),
          ...(body.consequences !== undefined
            ? { consequences: body.consequences }
            : {}),
          ...(body.exposed_group !== undefined
            ? { exposedGroup: body.exposed_group }
            : {}),
          ...(body.exposed_workers_count !== undefined
            ? { exposedWorkersCount: body.exposed_workers_count }
            : {}),
          ...(body.exposure_time !== undefined
            ? { exposureTime: textOrNull(body.exposure_time) }
            : {}),
          ...(body.exposure_frequency !== undefined
            ? { exposureFrequency: textOrNull(body.exposure_frequency) }
            : {}),
          ...(body.exposure_intensity !== undefined
            ? { exposureIntensity: textOrNull(body.exposure_intensity) }
            : {}),
          ...(body.monitoring_data !== undefined
            ? { monitoringData: textOrNull(body.monitoring_data) }
            : {}),
          ...(body.origin !== undefined ? { origin: body.origin as never } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.category !== undefined ? { category: body.category } : {}),
        },
      );
      await audit(req, "hazard.update", "Hazard", existing.id,
        { description: existing.description, category: existing.category, exposedWorkersCount: existing.exposedWorkersCount },
        { description: row?.description, category: row?.category, exposedWorkersCount: row?.exposedWorkersCount });
      res.json({ hazard: row });
    } catch (err) {
      fail(res, err);
    }
  }

  async archiveHazard(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const row = await new Hazard().update.one(
        { id: req.params.id, organizationId: orgId, archivedAt: null },
        { archivedAt: new Date() },
      );
      if (!row) {
        res.status(404).json({ message: "Perigo não encontrado." });
        return;
      }
      res.json({ hazard: row });
    } catch (err) {
      fail(res, err);
    }
  }

  // —— Risks ——
  async listRisks(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const hazardId = req.query.hazard_id as string | undefined;
      const where: Record<string, unknown> = {
        organizationId: orgId,
        archivedAt: null,
      };
      if (hazardId) where.hazardId = hazardId;
      const rows = await prisma.risk.findMany({
        where: where as never,
        include: {
          assessments: {
            where: { status: AssessmentStatus.VALIDATED },
            orderBy: { validatedAt: "desc" },
            take: 1,
          },
        },
        orderBy: { createdAt: "desc" },
      });
      res.json({ risks: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async createRisk(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const { hazard_id, description } = req.body as {
        hazard_id?: string;
        description?: string;
      };
      if (!hazard_id || !description?.trim()) {
        res.status(400).json({ message: "Informe hazard_id e description." });
        return;
      }
      const hazard = await new Hazard().read.one({
        id: hazard_id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!hazard) {
        res.status(400).json({ message: "Perigo inválido." });
        return;
      }
      const row = await new Risk().create.new({
        organizationId: orgId,
        hazardId: hazard_id,
        description: description.trim(),
      });
      await audit(req, "risk.create", "Risk", row.id, null, { description: row.description });
      res.status(201).json({ risk: row });
    } catch (err) {
      fail(res, err);
    }
  }

  async updateRisk(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const existing = await new Risk().read.one({
        id: req.params.id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!existing) {
        res.status(404).json({ message: "Risco não encontrado." });
        return;
      }
      const { description } = req.body as { description?: string };
      if (description !== undefined && !description.trim()) {
        res.status(400).json({ message: "A descrição do risco não pode ficar vazia." });
        return;
      }
      const row = await new Risk().update.one(
        { id: req.params.id, organizationId: orgId },
        {
          ...(description !== undefined
            ? { description: description.trim() }
            : {}),
        },
      );
      await audit(req, "risk.update", "Risk", existing.id,
        { description: existing.description },
        { description: row?.description });
      res.json({ risk: row });
    } catch (err) {
      fail(res, err);
    }
  }

  async archiveRisk(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const row = await new Risk().update.one(
        { id: req.params.id, organizationId: orgId, archivedAt: null },
        { archivedAt: new Date() },
      );
      if (!row) {
        res.status(404).json({ message: "Risco não encontrado." });
        return;
      }
      res.json({ risk: row });
    } catch (err) {
      fail(res, err);
    }
  }

  // —— Assessments ——
  async listAssessments(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const riskId = req.query.risk_id as string | undefined;
      const where: Record<string, unknown> = { organizationId: orgId };
      if (riskId) where.riskId = riskId;
      const rows = await new RiskAssessment().read.all(
        where,
        {},
        { createdAt: "desc" },
      );
      res.json({ assessments: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Histórico de um risco: de onde ele vem, todas as avaliações (inclusive as
   * substituídas, com quem avaliou e quem validou), os controles e as ações.
   * É o que a fiscalização pede: quem mudou o quê e quando. [S2-N]
   */
  async riskHistory(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const risk = await prisma.risk.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: {
          hazard: {
            include: {
              activity: { include: { sector: true, establishment: true } },
            },
          },
          assessments: {
            orderBy: { assessedAt: "desc" },
            include: {
              assessor: { select: { id: true, name: true } },
              validatedBy: { select: { id: true, name: true } },
              methodologyVersion: {
                select: { version: true, methodology: { select: { name: true } } },
              },
            },
          },
          controls: {
            orderBy: { createdAt: "desc" },
            include: {
              actions: {
                orderBy: { createdAt: "desc" },
                select: {
                  id: true,
                  title: true,
                  status: true,
                  dueDate: true,
                  completedAt: true,
                  validatedAt: true,
                },
              },
            },
          },
          actions: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              title: true,
              status: true,
              priority: true,
              dueDate: true,
              completedAt: true,
              validatedAt: true,
              controlId: true,
              assignee: { select: { id: true, name: true } },
            },
          },
        },
      });
      if (!risk) {
        res.status(404).json({ message: "Risco não encontrado." });
        return;
      }

      // Mudanças registradas na trilha para o risco, o perigo e a atividade.
      const changes = await prisma.auditEvent.findMany({
        where: {
          organizationId: orgId,
          entityId: { in: [risk.id, risk.hazardId, risk.hazard.activityId] },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          action: true,
          entityType: true,
          before: true,
          after: true,
          createdAt: true,
          actor: { select: { id: true, name: true } },
        },
      });

      res.json({
        risk: {
          id: risk.id,
          description: risk.description,
          needsReassessment: risk.needsReassessment,
          reassessmentReason: risk.reassessmentReason,
          createdAt: risk.createdAt,
          hazard: {
            id: risk.hazard.id,
            description: risk.hazard.description,
            category: risk.hazard.category,
            activity: risk.hazard.activity.name,
            sector: risk.hazard.activity.sector.name,
            establishment: risk.hazard.activity.establishment.name,
          },
        },
        assessments: risk.assessments.map((a) => ({
          id: a.id,
          severity: a.severity,
          probability: a.probability,
          level: a.resultingLevel,
          status: a.status,
          severityReason: a.severityReason,
          probabilityReason: a.probabilityReason,
          controlsConsidered: a.controlsConsidered,
          assessedAt: a.assessedAt,
          expiresAt: a.expiresAt,
          validatedAt: a.validatedAt,
          supersededAt: a.supersededAt,
          assessor: a.assessor,
          validatedBy: a.validatedBy,
          methodology: `${a.methodologyVersion.methodology.name} v${a.methodologyVersion.version}`,
        })),
        controls: risk.controls,
        actions: risk.actions,
        changes,
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async createAssessment(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const {
        risk_id,
        methodology_version_id,
        severity,
        probability,
        severity_reason,
        probability_reason,
        controls_considered,
      } = req.body as {
        risk_id?: string;
        methodology_version_id?: string;
        severity?: number;
        probability?: number;
        severity_reason?: string;
        probability_reason?: string;
        controls_considered?: string;
      };
      if (
        !risk_id ||
        !methodology_version_id ||
        severity == null ||
        probability == null
      ) {
        res.status(400).json({
          message:
            "Informe risk_id, methodology_version_id, severity e probability.",
        });
        return;
      }
      const risk = await new Risk().read.one({
        id: risk_id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!risk) {
        res.status(400).json({ message: "Risco inválido." });
        return;
      }
      const version = await prisma.riskMethodologyVersion.findFirst({
        where: { id: methodology_version_id },
        include: { methodology: true },
      });
      if (
        !version ||
        (version.methodology.organizationId &&
          version.methodology.organizationId !== orgId)
      ) {
        res.status(400).json({ message: "Metodologia inválida." });
        return;
      }
      const resultingLevel = resolveLevel(version, severity, probability);
      const row = await new RiskAssessment().create.new({
        organizationId: orgId,
        riskId: risk_id,
        methodologyVersionId: methodology_version_id,
        severity,
        probability,
        resultingLevel,
        severityReason: severity_reason ?? null,
        probabilityReason: probability_reason ?? null,
        controlsConsidered: controls_considered ?? null,
        status: AssessmentStatus.DRAFT,
        assessorId: userId,
      });
      await audit(req, "assessment.create", "Risk", risk_id, null, {
        severity,
        probability,
        level: resultingLevel,
      });
      res.status(201).json({ assessment: row });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Valida avaliação (BR-1/2/3/18): imutável após VALIDATED;
   * supersede a vigente; limpa needsReassessment; define expiresAt.
   */
  async validateAssessment(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const id = req.params.id;

      const result = await prisma.$transaction(async (tx) => {
        const assessment = await tx.riskAssessment.findFirst({
          where: { id, organizationId: orgId },
        });
        if (!assessment) {
          throw Object.assign(new Error("Avaliação não encontrada."), {
            status: 404,
          });
        }
        if (assessment.status === AssessmentStatus.VALIDATED) {
          throw Object.assign(
            new Error("Avaliação já validada é imutável."),
            { status: 409 },
          );
        }
        if (assessment.assessorId === userId) {
          throw Object.assign(
            new Error("Quem avaliou não pode validar (separação de funções)."),
            { status: 403 },
          );
        }

        const org = await tx.organization.findFirst({ where: { id: orgId } });
        const months = org?.assessmentReviewMonths ?? 24;
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + months);

        const previous = await tx.riskAssessment.findFirst({
          where: {
            riskId: assessment.riskId,
            organizationId: orgId,
            status: AssessmentStatus.VALIDATED,
          },
        });

        const validated = await tx.riskAssessment.update({
          where: { id },
          data: {
            status: AssessmentStatus.VALIDATED,
            validatedById: userId,
            validatedAt: new Date(),
            expiresAt,
          },
        });

        if (previous) {
          await tx.riskAssessment.update({
            where: { id: previous.id },
            data: {
              status: AssessmentStatus.SUPERSEDED,
              supersededById: validated.id,
              supersededAt: new Date(),
            },
          });
        }

        await tx.risk.update({
          where: { id: assessment.riskId },
          data: { needsReassessment: false, reassessmentReason: null },
        });

        return validated;
      });

      await audit(req, "assessment.validate", "Risk", result.riskId, null, {
        level: result.resultingLevel,
        severity: result.severity,
        probability: result.probability,
      });
      res.json({ assessment: result });
    } catch (err) {
      fail(res, err);
    }
  }

  // —— Controls ——
  async listControls(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const riskId = req.query.risk_id as string | undefined;
      const where: Record<string, unknown> = {
        organizationId: orgId,
        archivedAt: null,
      };
      if (riskId) where.riskId = riskId;
      const rows = await new ControlMeasure().read.all(
        where,
        {},
        { createdAt: "desc" },
      );
      res.json({ controls: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async createControl(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const { risk_id, type, description } = req.body as {
        risk_id?: string;
        type?: ControlType;
        description?: string;
      };
      if (!risk_id || !type || !description?.trim()) {
        res.status(400).json({ message: "Informe risk_id, type e description." });
        return;
      }
      const risk = await new Risk().read.one({
        id: risk_id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!risk) {
        res.status(400).json({ message: "Risco inválido." });
        return;
      }
      const row = await new ControlMeasure().create.new({
        organizationId: orgId,
        riskId: risk_id,
        type,
        description: description.trim(),
        status: ControlStatus.PLANNED,
      });
      await audit(req, "control.create", "Risk", risk_id, null, {
        type: row.type,
        description: row.description,
      });
      res.status(201).json({ control: row });
    } catch (err) {
      fail(res, err);
    }
  }

  // —— Actions (plano de ação mínimo) ——
  async listActions(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const riskId = req.query.risk_id as string | undefined;
      const where: Record<string, unknown> = { organizationId: orgId };
      if (riskId) where.riskId = riskId;
      const rows = await new Action().read.all(where, {}, { createdAt: "desc" });
      res.json({ actions: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async createAction(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const {
        title,
        description,
        risk_id,
        control_id,
        priority,
        assignee_id,
        due_date,
        effectiveness_criteria,
      } = req.body as {
        title?: string;
        description?: string;
        risk_id?: string;
        control_id?: string;
        priority?: string;
        assignee_id?: string;
        due_date?: string;
        effectiveness_criteria?: string;
      };
      if (!title?.trim()) {
        res.status(400).json({ message: "Informe o título." });
        return;
      }
      /*
        NR-1 1.5.5.2: o plano de ação diz o que será feito, POR QUEM e ATÉ
        QUANDO. Ação sem dono e sem prazo não cobra ninguém. [S2-M]
      */
      if (!assignee_id) {
        res.status(400).json({ message: "Informe quem é o responsável pela ação." });
        return;
      }
      if (!due_date) {
        res.status(400).json({ message: "Informe o prazo da ação." });
        return;
      }
      const responsavel = await prisma.membership.findFirst({
        where: { userId: assignee_id, organizationId: orgId },
        select: { accessExpiresAt: true, user: { select: { active: true } } },
      });
      if (!responsavel || !responsavel.user.active) {
        res.status(400).json({ message: "Responsável não é da organização." });
        return;
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
      if (control_id) {
        const control = await new ControlMeasure().read.one({
          id: control_id,
          organizationId: orgId,
          ...(risk_id ? { riskId: risk_id } : {}),
        });
        if (!control) {
          res.status(400).json({ message: "Medida de controle inválida para este risco." });
          return;
        }
      }
      const row = await new Action().create.new({
        organizationId: orgId,
        title: title.trim(),
        description: description ?? null,
        sourceType: risk_id ? "RISK" : "MANUAL",
        riskId: risk_id ?? null,
        controlId: control_id ?? null,
        priority: (priority as never) ?? "MEDIUM",
        assigneeId: assignee_id ?? null,
        dueDate: due_date ? new Date(due_date) : null,
        effectivenessCriteria: effectiveness_criteria ?? null,
        createdById: userId,
      });
      await audit(req, "action.create", "Risk", risk_id ?? row.id, null, {
        title: row.title,
        priority: row.priority,
        dueDate: row.dueDate,
        assigneeId: row.assigneeId,
      });
      res.status(201).json({ action: row });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new RiskController();
