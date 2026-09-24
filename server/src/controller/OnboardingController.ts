import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function blank(v?: string | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

class OnboardingController {
  async listSteps(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const steps = await prisma.onboardingStep.findMany({
        where: { organizationId: orgId },
        orderBy: { order: "asc" },
        include: {
          progress: { where: { userId }, take: 1 },
        },
      });
      res.json({
        steps: steps.map((s) => ({
          ...s,
          done_at: s.progress[0]?.doneAt ?? null,
          progress: undefined,
        })),
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async createStep(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const { order, title, description } = req.body as {
        order?: number;
        title?: string;
        description?: string;
      };
      if (typeof order !== "number" || !title?.trim()) {
        res.status(400).json({ message: "Informe order e title." });
        return;
      }
      const step = await prisma.onboardingStep.create({
        data: {
          organizationId: orgId,
          order,
          title: title.trim(),
          description: blank(description),
        },
      });
      res.status(201).json({ step });
    } catch (err) {
      fail(res, err);
    }
  }

  async completeStep(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const step = await prisma.onboardingStep.findFirst({
        where: { id: req.params.id, organizationId: orgId },
      });
      if (!step) {
        res.status(404).json({ message: "Passo não encontrado." });
        return;
      }
      const progress = await prisma.onboardingProgress.upsert({
        where: {
          stepId_userId: { stepId: step.id, userId },
        },
        create: { stepId: step.id, userId },
        update: { doneAt: new Date() },
      });
      res.json({ progress });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new OnboardingController();
