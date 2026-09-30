import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { canWriteModule } from "../helper/module-access";
import {
  SURVEY_STATUSES,
  SURVEY_STATUS_VALUES,
  isSurveyStatus,
} from "../constants";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function blank(v?: string | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

function isRh(req: AuthRequest) {
  return Boolean(req.actor && canWriteModule(req.actor.permission, "clima"));
}

class ClimateController {
  async list(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const rows = await prisma.climateSurvey.findMany({
        where: {
          organizationId: orgId,
          ...(!isRh(req as AuthRequest)
            ? { status: SURVEY_STATUSES.OPEN }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { questions: true, responses: true } },
        },
      });
      res.json({ surveys: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async create(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const {
        title,
        description,
        is_anonymous,
        questions,
      } = req.body as {
        title?: string;
        description?: string;
        is_anonymous?: boolean;
        questions?: Array<{
          order?: number;
          prompt?: string;
          factor_id?: string;
        }>;
      };
      if (!title?.trim()) {
        res.status(400).json({ message: "Informe title." });
        return;
      }

      const survey = await prisma.$transaction(async (tx) => {
        const created = await tx.climateSurvey.create({
          data: {
            organizationId: orgId,
            title: title.trim(),
            description: blank(description),
            isAnonymous: is_anonymous !== false,
            status: SURVEY_STATUSES.DRAFT,
            createdById: userId,
          },
        });
        if (Array.isArray(questions)) {
          for (const [i, q] of questions.entries()) {
            if (!q.prompt?.trim()) continue;
            await tx.climateQuestion.create({
              data: {
                surveyId: created.id,
                order: q.order ?? i + 1,
                prompt: q.prompt.trim(),
                factorId: blank(q.factor_id),
              },
            });
          }
        }
        return created;
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "climate_survey.create",
        entityType: "ClimateSurvey",
        entityId: survey.id,
      });
      res.status(201).json({ survey });
    } catch (err) {
      fail(res, err);
    }
  }

  async open(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const survey = await prisma.climateSurvey.findFirst({
        where: { id: req.params.id, organizationId: orgId },
      });
      if (!survey) {
        res.status(404).json({ message: "Pesquisa não encontrada." });
        return;
      }
      const updated = await prisma.climateSurvey.update({
        where: { id: survey.id },
        data: {
          status: SURVEY_STATUSES.OPEN,
          opensAt: new Date(),
        },
      });
      res.json({ survey: updated });
    } catch (err) {
      fail(res, err);
    }
  }

  async get(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const survey = await prisma.climateSurvey.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: {
          questions: { orderBy: { order: "asc" } },
          _count: { select: { responses: true } },
        },
      });
      if (!survey) {
        res.status(404).json({ message: "Pesquisa não encontrada." });
        return;
      }
      res.json({ survey });
    } catch (err) {
      fail(res, err);
    }
  }

  async respond(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const survey = await prisma.climateSurvey.findFirst({
        where: {
          id: req.params.id,
          organizationId: orgId,
          status: SURVEY_STATUSES.OPEN,
        },
        include: { questions: true },
      });
      if (!survey) {
        res.status(404).json({
          message: "Pesquisa não encontrada ou fechada.",
        });
        return;
      }

      const { answers } = req.body as {
        answers?: Array<{
          question_id?: string;
          score?: number;
          text?: string;
        }>;
      };
      if (!Array.isArray(answers) || answers.length === 0) {
        res.status(400).json({ message: "Informe answers." });
        return;
      }

      const response = await prisma.$transaction(async (tx) => {
        const created = await tx.climateResponse.create({
          data: {
            surveyId: survey.id,
            userId: survey.isAnonymous ? null : userId,
          },
        });
        for (const a of answers) {
          if (!a.question_id) continue;
          await tx.climateAnswer.create({
            data: {
              responseId: created.id,
              questionId: a.question_id,
              score: a.score ?? null,
              text: blank(a.text),
            },
          });
        }
        return created;
      });

      res.status(201).json({
        response: {
          id: response.id,
          surveyId: response.surveyId,
          submittedAt: response.submittedAt,
          // Nunca devolve userId se anônima
          anonymous: survey.isAnonymous,
        },
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async close(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const survey = await prisma.climateSurvey.findFirst({
        where: { id: req.params.id, organizationId: orgId },
      });
      if (!survey) {
        res.status(404).json({ message: "Pesquisa não encontrada." });
        return;
      }
      const updated = await prisma.climateSurvey.update({
        where: { id: survey.id },
        data: { status: SURVEY_STATUSES.CLOSED, closesAt: new Date() },
      });
      res.json({ survey: updated });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new ClimateController();
