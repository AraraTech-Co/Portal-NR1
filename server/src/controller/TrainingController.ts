import { randomBytes } from "crypto";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { Training } from "../model/schema/Training/Training";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { notify } from "../helper/notify";
import { canManageModule, canSeeAllInModule } from "../helper/module-access";
import { NotificationKind, TrainingKind } from "@prisma/client";
import { ENROLLMENT_STATUSES } from "../constants";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function blank(v?: string | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

/** Padrão da nota mínima quando o RH não informa. [S4-K] */
const DEFAULT_PASSING_SCORE = 70;

/** Vencimento do certificado a partir da validade do treinamento. */
function expiryFrom(validityMonths: number | null): Date | null {
  if (!validityMonths) return null;
  const d = new Date();
  d.setMonth(d.getMonth() + validityMonths);
  return d;
}

function isRh(req: AuthRequest): boolean {
  return Boolean(req.actor && canManageModule(req.actor.permission, "treinamentos"));
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

  /**
   * Quem fez o treinamento, quando, com que nota e qual certificado. Para
   * quem cuida dos treinamentos e para a fiscalização. [S5-J] [S7-G]
   */
  async listEnrollments(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      if (!auth.actor || !canSeeAllInModule(auth.actor.permission, "treinamentos")) {
        res.status(403).json({ message: "Sem permissão para ver quem fez o treinamento." });
        return;
      }
      const orgId = actorOrgId(auth);
      const training = await prisma.training.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        select: { id: true, title: true, validityMonths: true },
      });
      if (!training) {
        res.status(404).json({ message: "Treinamento não encontrado." });
        return;
      }
      const rows = await prisma.trainingEnrollment.findMany({
        where: { trainingId: training.id },
        orderBy: [{ completedAt: "desc" }, { startedAt: "desc" }],
        select: {
          id: true,
          status: true,
          startedAt: true,
          completedAt: true,
          score: true,
          certificateCode: true,
          expiresAt: true,
          user: { select: { id: true, name: true } },
        },
      });
      res.json({ training, enrollments: rows });
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
        kind,
        passing_score,
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
        kind?: string;
        passing_score?: number;
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
      const resolvedKind = (kind ?? TrainingKind.ONLINE) as TrainingKind;
      if (!Object.values(TrainingKind).includes(resolvedKind)) {
        res.status(400).json({
          message: `kind deve ser um de: ${Object.values(TrainingKind).join(", ")}.`,
        });
        return;
      }
      const passingScore = passing_score ?? DEFAULT_PASSING_SCORE;
      if (!Number.isInteger(passingScore) || passingScore < 0 || passingScore > 100) {
        res.status(400).json({ message: "A nota mínima vai de 0 a 100." });
        return;
      }

      const training = await prisma.$transaction(async (tx) => {
        const created = await tx.training.create({
          data: {
            organizationId: orgId,
            title: title.trim(),
            category: blank(category) || "GERAL",
            kind: resolvedKind,
            passingScore,
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

      // Presencial se conclui pela lista de presença da turma, não pelo botão:
      // quem diz que a pessoa esteve na aula é quem deu a aula. [S4-D]
      if (training.kind === TrainingKind.CLASSROOM) {
        res.status(409).json({
          message:
            "Este treinamento é presencial: a conclusão vem da lista de presença da turma.",
        });
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

      // Nota abaixo da mínima não gera certificado: certificado é prova de
      // capacitação perante a fiscalização, não comprovante de presença. [S4-K]
      const passed = score >= training.passingScore;
      if (!passed) {
        enrollment = await prisma.trainingEnrollment.update({
          where: { id: enrollment.id },
          data: {
            status: ENROLLMENT_STATUSES.FAILED,
            score,
            startedAt: enrollment.startedAt ?? new Date(),
            completedAt: null,
            certificateCode: null,
            expiresAt: null,
          },
        });
        res.json({
          enrollment,
          passed: false,
          passing_score: training.passingScore,
          message: `Você acertou ${score}% e a nota mínima é ${training.passingScore}%. Reveja o conteúdo e tente de novo.`,
        });
        return;
      }

      enrollment = await prisma.trainingEnrollment.update({
        where: { id: enrollment.id },
        data: {
          status: ENROLLMENT_STATUSES.COMPLETED,
          completedAt: new Date(),
          score,
          certificateCode: `TR-${randomBytes(4).toString("hex").toUpperCase()}`,
          expiresAt: expiryFrom(training.validityMonths),
          startedAt: enrollment.startedAt ?? new Date(),
        },
      });

      await notify({
        organizationId: orgId,
        userId,
        kind: NotificationKind.TRAINING_COMPLETED,
        title: `Certificado de ${training.title}`,
        body: `Você concluiu com ${score}%. O certificado está em Treinamentos.`,
        link: `/treinamentos/${training.id}`,
        entityType: "Training",
        entityId: training.id,
      });

      res.json({ enrollment, passed: true, passing_score: training.passingScore });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Registra a turma presencial que aconteceu: instrutor, data, carga horária
   * e quem esteve. Quem esteve e passou sai com certificado — é o mesmo
   * comprovante do curso online, para a ficha e para a fiscalização. [S4-D]
   */
  async createSession(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      if (!isRh(auth)) {
        res.status(403).json({ message: "Sem permissão para registrar turma." });
        return;
      }

      const training = await prisma.training.findFirst({
        where: { id: req.params.id, organizationId: orgId, archivedAt: null },
        select: { id: true, kind: true, durationMinutes: true, passingScore: true, validityMonths: true },
      });
      if (!training) {
        res.status(404).json({ message: "Treinamento não encontrado." });
        return;
      }
      if (training.kind !== TrainingKind.CLASSROOM) {
        res.status(400).json({
          message: "Turma é de treinamento presencial. Mude o tipo do treinamento para presencial.",
        });
        return;
      }

      const body = req.body as {
        held_at?: string;
        instructor_name?: string;
        instructor_registration?: string;
        location?: string;
        duration_minutes?: number;
        notes?: string;
        attendees?: Array<{ user_id?: string; present?: boolean; score?: number }>;
      };

      const instrutor = blank(body.instructor_name);
      if (!instrutor) {
        res.status(400).json({ message: "Informe quem deu o treinamento." });
        return;
      }
      if (!body.held_at) {
        res.status(400).json({ message: "Informe a data da turma." });
        return;
      }
      const heldAt = new Date(String(body.held_at));
      if (Number.isNaN(heldAt.getTime())) {
        res.status(400).json({ message: "Data da turma inválida." });
        return;
      }
      if (heldAt.getTime() > Date.now()) {
        res.status(400).json({
          message: "A turma ainda não aconteceu — registre a presença depois da aula.",
        });
        return;
      }
      const duracao = body.duration_minutes ?? training.durationMinutes;
      if (!Number.isInteger(duracao) || duracao <= 0) {
        res.status(400).json({ message: "Informe a carga horária em minutos." });
        return;
      }

      const lista = Array.isArray(body.attendees) ? body.attendees : [];
      const ids = [...new Set(lista.map((a) => String(a.user_id ?? "")).filter(Boolean))];
      if (ids.length === 0) {
        res.status(400).json({ message: "Informe quem esteve na turma." });
        return;
      }
      const membros = await prisma.membership.findMany({
        where: { organizationId: orgId, userId: { in: ids }, user: { active: true } },
        select: { userId: true },
      });
      const membroValido = new Set(membros.map((m) => m.userId));
      const forasteiros = ids.filter((id) => !membroValido.has(id));
      if (forasteiros.length > 0) {
        res.status(400).json({
          message: "Há pessoas na lista que não são da empresa.",
        });
        return;
      }

      const session = await prisma.$transaction(async (tx) => {
        const criada = await tx.trainingSession.create({
          data: {
            organizationId: orgId,
            trainingId: training.id,
            heldAt,
            instructorName: instrutor,
            instructorRegistration: blank(body.instructor_registration),
            location: blank(body.location),
            durationMinutes: duracao,
            notes: blank(body.notes),
            recordedById: userId,
          },
        });

        for (const entrada of lista) {
          const alvo = String(entrada.user_id ?? "");
          if (!alvo || !membroValido.has(alvo)) continue;
          const presente = entrada.present !== false;
          const nota =
            typeof entrada.score === "number" && Number.isFinite(entrada.score)
              ? Math.max(0, Math.min(100, Math.round(entrada.score)))
              : null;

          await tx.trainingAttendance.upsert({
            where: { sessionId_userId: { sessionId: criada.id, userId: alvo } },
            create: { sessionId: criada.id, userId: alvo, present: presente, score: nota },
            update: { present: presente, score: nota },
          });

          // Faltou: fica o registro da falta, sem certificado.
          if (!presente) continue;

          const passou = nota === null || nota >= training.passingScore;
          await tx.trainingEnrollment.upsert({
            where: { trainingId_userId: { trainingId: training.id, userId: alvo } },
            create: {
              trainingId: training.id,
              userId: alvo,
              status: passou
                ? ENROLLMENT_STATUSES.COMPLETED
                : ENROLLMENT_STATUSES.FAILED,
              startedAt: heldAt,
              completedAt: passou ? heldAt : null,
              score: nota,
              certificateCode: passou
                ? `TR-${randomBytes(4).toString("hex").toUpperCase()}`
                : null,
              expiresAt: passou ? expiryFrom(training.validityMonths) : null,
            },
            update: {
              status: passou
                ? ENROLLMENT_STATUSES.COMPLETED
                : ENROLLMENT_STATUSES.FAILED,
              startedAt: heldAt,
              completedAt: passou ? heldAt : null,
              score: nota,
              ...(passou
                ? { expiresAt: expiryFrom(training.validityMonths) }
                : { certificateCode: null, expiresAt: null }),
            },
          });
        }

        return criada;
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "training_session.create",
        entityType: "TrainingSession",
        entityId: session.id,
        after: { trainingId: training.id, present: lista.filter((a) => a.present !== false).length },
      });

      res.status(201).json({ session });
    } catch (err) {
      fail(res, err);
    }
  }

  /** As turmas já dadas, com instrutor e lista de presença. [S4-D] */
  async listSessions(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      if (!auth.actor || !canSeeAllInModule(auth.actor.permission, "treinamentos")) {
        res.status(403).json({ message: "Sem permissão para ver as turmas." });
        return;
      }
      const orgId = actorOrgId(auth);
      const training = await prisma.training.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        select: { id: true, title: true, kind: true },
      });
      if (!training) {
        res.status(404).json({ message: "Treinamento não encontrado." });
        return;
      }
      const rows = await prisma.trainingSession.findMany({
        where: { trainingId: training.id },
        orderBy: { heldAt: "desc" },
        include: {
          recordedBy: { select: { id: true, name: true } },
          attendances: {
            include: { user: { select: { id: true, name: true } } },
          },
        },
      });

      res.json({
        training,
        sessions: rows.map((s) => ({
          id: s.id,
          held_at: s.heldAt,
          instructor_name: s.instructorName,
          instructor_registration: s.instructorRegistration,
          location: s.location,
          duration_minutes: s.durationMinutes,
          notes: s.notes,
          recorded_by: s.recordedBy,
          present: s.attendances.filter((a) => a.present).length,
          absent: s.attendances.filter((a) => !a.present).length,
          attendances: s.attendances
            .map((a) => ({
              user: a.user,
              present: a.present,
              score: a.score,
            }))
            .sort((a, b) => a.user.name.localeCompare(b.user.name, "pt-BR")),
        })),
      });
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
