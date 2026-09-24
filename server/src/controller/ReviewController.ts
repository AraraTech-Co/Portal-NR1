import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { can } from "../helper/permissions";
import { SURVEY_STATUSES } from "../constants";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function blank(v?: string | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

function isRh(req: AuthRequest) {
  return Boolean(req.actor && can(req.actor.permission, "rh"));
}

class ReviewController {
  async listCycles(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const rows = await prisma.reviewCycle.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { assignments: true } } },
      });
      res.json({ cycles: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async createCycle(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const { title } = req.body as { title?: string };
      if (!title?.trim()) {
        res.status(400).json({ message: "Informe title." });
        return;
      }
      const cycle = await prisma.reviewCycle.create({
        data: {
          organizationId: orgId,
          title: title.trim(),
          status: SURVEY_STATUSES.DRAFT,
          createdById: userId,
        },
      });
      res.status(201).json({ cycle });
    } catch (err) {
      fail(res, err);
    }
  }

  async assign(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const cycle = await prisma.reviewCycle.findFirst({
        where: { id: req.params.id, organizationId: orgId },
      });
      if (!cycle) {
        res.status(404).json({ message: "Ciclo não encontrado." });
        return;
      }
      const { reviewer_user_id, reviewee_user_id } = req.body as {
        reviewer_user_id?: string;
        reviewee_user_id?: string;
      };
      if (!reviewer_user_id || !reviewee_user_id) {
        res.status(400).json({
          message: "Informe reviewer_user_id e reviewee_user_id.",
        });
        return;
      }
      const assignment = await prisma.reviewAssignment.create({
        data: {
          cycleId: cycle.id,
          reviewerUserId: reviewer_user_id,
          revieweeUserId: reviewee_user_id,
        },
      });
      res.status(201).json({ assignment });
    } catch (err) {
      fail(res, err);
    }
  }

  async myAssignments(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const rows = await prisma.reviewAssignment.findMany({
        where: {
          reviewerUserId: userId,
          cycle: { organizationId: orgId },
        },
        include: {
          cycle: { select: { id: true, title: true, status: true } },
          reviewee: { select: { id: true, name: true } },
        },
      });
      res.json({ assignments: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async submit(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const assignment = await prisma.reviewAssignment.findFirst({
        where: {
          id: req.params.assignmentId,
          reviewerUserId: userId,
          cycle: { organizationId: orgId },
        },
      });
      if (!assignment) {
        res.status(404).json({ message: "Atribuição não encontrada." });
        return;
      }
      if (assignment.submittedAt) {
        res.status(409).json({ message: "Já enviada." });
        return;
      }
      const { answers } = req.body as {
        answers?: Array<{
          competency?: string;
          score?: number;
          comment?: string;
        }>;
      };
      if (!Array.isArray(answers) || answers.length === 0) {
        res.status(400).json({ message: "Informe answers." });
        return;
      }

      await prisma.$transaction(async (tx) => {
        for (const a of answers) {
          if (!a.competency?.trim() || typeof a.score !== "number") continue;
          await tx.reviewAnswer.create({
            data: {
              assignmentId: assignment.id,
              competency: a.competency.trim(),
              score: a.score,
              comment: blank(a.comment),
            },
          });
        }
        await tx.reviewAssignment.update({
          where: { id: assignment.id },
          data: { submittedAt: new Date() },
        });
      });

      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  }

  async openCycle(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const cycle = await prisma.reviewCycle.findFirst({
        where: { id: req.params.id, organizationId: orgId },
      });
      if (!cycle) {
        res.status(404).json({ message: "Ciclo não encontrado." });
        return;
      }
      const updated = await prisma.reviewCycle.update({
        where: { id: cycle.id },
        data: { status: SURVEY_STATUSES.OPEN, opensAt: new Date() },
      });
      res.json({ cycle: updated });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new ReviewController();
