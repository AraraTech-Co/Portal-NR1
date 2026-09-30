import { randomBytes } from "crypto";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { Training } from "../model/schema/Training/Training";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { canWriteModule } from "../helper/module-access";
import { ENROLLMENT_STATUSES } from "../constants";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function blank(v?: string | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

function isRh(req: AuthRequest): boolean {
  return Boolean(req.actor && canWriteModule(req.actor.permission, "treinamentos"));
}

class TrainingController {
  async list(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const includeArchived = req.query.include_archived === "true";
      const rows = await prisma.training.findMany({
        where: {
          organizationId: orgId,
          ...(includeArchived ? {} : { archivedAt: null }),
        },
        orderBy: { title: "asc" },
        include: {
          _count: {
            select: { slides: true, questions: true, enrollments: true },
          },
        },
      });
      res.json({ trainings: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async get(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const training = await prisma.training.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: {
          slides: { orderBy: { order: "asc" } },
          questions: {
            orderBy: { order: "asc" },
            // Esconde gabarito para quem não é RH
            select: isRh(auth)
              ? undefined
              : {
                  id: true,
                  order: true,
                  prompt: true,
                  options: true,
                },
          },
          enrollments: {
            where: { userId },
            take: 1,
          },
        },
      });
      if (!training) {
        res.status(404).json({ message: "Treinamento não encontrado." });
        return;
      }
      res.json({
        training: {
          ...training,
          my_enrollment: training.enrollments[0] ?? null,
          enrollments: undefined,
        },
      });
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
        category,
        summary,
        duration_minutes,
        points,
        video_url,
        validity_months,
        slides,
        questions,
      } = req.body as {
        title?: string;
        category?: string;
        summary?: string;
        duration_minutes?: number;
        points?: number;
        video_url?: string;
        validity_months?: number;
        slides?: Array<{ order?: number; title?: string; body?: string }>;
        questions?: Array<{
          order?: number;
          prompt?: string;
          options?: string[];
          correct_index?: number;
        }>;
      };

      if (!title?.trim()) {
        res.status(400).json({ message: "Informe title." });
        return;
      }

      const training = await prisma.$transaction(async (tx) => {
        const created = await tx.training.create({
          data: {
            organizationId: orgId,
            title: title.trim(),
            category: blank(category) || "GERAL",
            summary: blank(summary),
            durationMinutes: duration_minutes ?? 30,
            points: points ?? 100,
            videoUrl: blank(video_url),
            validityMonths: validity_months ?? null,
            createdById: userId,
          },
        });

        if (Array.isArray(slides) && slides.length) {
          await tx.trainingSlide.createMany({
            data: slides.map((s, i) => ({
              trainingId: created.id,
              order: s.order ?? i + 1,
              title: blank(s.title),
              body: blank(s.body),
            })),
          });
        }

        if (Array.isArray(questions) && questions.length) {
          for (const [i, q] of questions.entries()) {
            if (!q.prompt?.trim() || !Array.isArray(q.options) || q.options.length < 2) {
              throw Object.assign(
                new Error("Cada pergunta precisa de prompt e ≥2 options."),
                { status: 400 },
              );
            }
            const correctIndex = q.correct_index ?? 0;
            if (correctIndex < 0 || correctIndex >= q.options.length) {
              throw Object.assign(new Error("correct_index inválido."), {
                status: 400,
              });
            }
            await tx.trainingQuestion.create({
              data: {
                trainingId: created.id,
                order: q.order ?? i + 1,
                prompt: q.prompt.trim(),
                options: q.options,
                correctIndex,
              },
            });
          }
        }

        return created;
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "training.create",
        entityType: "Training",
        entityId: training.id,
      });

      res.status(201).json({ training });
    } catch (err) {
      fail(res, err);
    }
  }

  async enroll(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const training = await new Training().read.one({
        id: req.params.id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!training) {
        res.status(404).json({ message: "Treinamento não encontrado." });
        return;
      }

      const enrollment = await prisma.trainingEnrollment.upsert({
        where: {
          trainingId_userId: { trainingId: training.id, userId },
        },
        create: {
          trainingId: training.id,
          userId,
          status: ENROLLMENT_STATUSES.PENDING,
        },
        update: {},
      });
      res.status(201).json({ enrollment });
    } catch (err) {
      fail(res, err);
    }
  }

  async start(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const training = await new Training().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!training) {
        res.status(404).json({ message: "Treinamento não encontrado." });
        return;
      }

      const enrollment = await prisma.trainingEnrollment.upsert({
        where: {
          trainingId_userId: { trainingId: training.id, userId },
        },
        create: {
          trainingId: training.id,
          userId,
          status: ENROLLMENT_STATUSES.IN_PROGRESS,
          startedAt: new Date(),
        },
        update: {
          status: ENROLLMENT_STATUSES.IN_PROGRESS,
          startedAt: new Date(),
        },
      });
      res.json({ enrollment });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Completa o treinamento. Se houver questões, body.answers: [{ question_id, index }].
   * Nota = % acertos; certificado gerado com validade do treinamento.
   */
  async complete(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const training = await prisma.training.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: { questions: true },
      });
      if (!training) {
        res.status(404).json({ message: "Treinamento não encontrado." });
        return;
      }

      let enrollment = await prisma.trainingEnrollment.findUnique({
        where: {
          trainingId_userId: { trainingId: training.id, userId },
        },
      });
      if (!enrollment) {
        res.status(400).json({ message: "Matricule-se antes de concluir." });
        return;
      }
      if (enrollment.status === ENROLLMENT_STATUSES.COMPLETED) {
        res.status(409).json({ message: "Treinamento já concluído." });
        return;
      }

      let score = 100;
      if (training.questions.length > 0) {
        const { answers } = req.body as {
          answers?: Array<{ question_id?: string; index?: number }>;
        };
        if (!Array.isArray(answers) || answers.length !== training.questions.length) {
          res.status(400).json({
            message: "Envie answers para todas as perguntas.",
          });
          return;
        }
        let correct = 0;
        for (const q of training.questions) {
          const a = answers.find((x) => x.question_id === q.id);
          if (a && a.index === q.correctIndex) correct += 1;
        }
        score = Math.round((correct / training.questions.length) * 100);
      }

      const certificateCode = `TR-${randomBytes(4).toString("hex").toUpperCase()}`;
      let expiresAt: Date | null = null;
      if (training.validityMonths) {
        expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + training.validityMonths);
      }

      enrollment = await prisma.trainingEnrollment.update({
        where: { id: enrollment.id },
        data: {
          status: ENROLLMENT_STATUSES.COMPLETED,
          completedAt: new Date(),
          score,
          certificateCode,
          expiresAt,
          startedAt: enrollment.startedAt ?? new Date(),
        },
      });

      res.json({ enrollment });
    } catch (err) {
      fail(res, err);
    }
  }

  async archive(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const current = await new Training().read.one({
        id: req.params.id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!current) {
        res.status(404).json({ message: "Treinamento não encontrado." });
        return;
      }
      const training = await new Training().update.one(
        { id: current.id },
        { archivedAt: new Date() },
      );
      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "training.archive",
        entityType: "Training",
        entityId: current.id,
      });
      res.json({ training });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new TrainingController();
