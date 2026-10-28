import { randomBytes } from "crypto";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { Training } from "../model/schema/Training/Training";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { notify, notifyMany } from "../helper/notify";
import { formatCalendarDayTime } from "../helper/calendar-day";
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

/**
 * Concluído que pode ser refeito: abaixo da nota mínima de hoje, ou vencido.
 * O certificado que a pessoa tem continua valendo até vencer, e refazer não
 * o apaga: só um certificado novo o substitui. [CB-31] [CB-65]
 */
function podeRefazer(
  e: { status: string; score: number | null; expiresAt: Date | null },
  notaMinima: number,
  agora = new Date(),
): boolean {
  if (e.status !== ENROLLMENT_STATUSES.COMPLETED) return false;
  const abaixo = e.score !== null && e.score < notaMinima;
  const vencido = e.expiresAt !== null && e.expiresAt.getTime() < agora.getTime();
  return abaixo || vencido;
}

function isRh(req: AuthRequest): boolean {
  return Boolean(req.actor && canManageModule(req.actor.permission, "treinamentos"));
}

class TrainingController {
  async list(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
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
          /*
            A situação de quem abre a lista: o curso concluído aparecia com
            "Fazer", como se a pessoa devesse o treinamento. [B3-3-B]
          */
          enrollments: {
            where: { userId },
            take: 1,
            select: { id: true, status: true, completedAt: true, expiresAt: true },
          },
        },
      });
      res.json({
        trainings: rows.map(({ enrollments, ...t }) => ({
          ...t,
          my_enrollment: enrollments[0] ?? null,
        })),
      });
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
      const minha = training.enrollments[0] ?? null;

      /*
        O convocado abria o treinamento presencial e não via a turma para a
        qual foi chamado: ela só aparecia no aviso e em Convocações. Vem a
        turma que ainda espera a lista de presença — a próxima, ou a que já
        aconteceu e falta lançar. [B3-3-C]
      */
      let minhaTurma = null;
      if (training.kind === TrainingKind.CLASSROOM) {
        const chamadas = await prisma.summonAttendance.findMany({
          where: {
            userId,
            summon: {
              organizationId: orgId,
              trainingSession: {
                trainingId: training.id,
                attendances: { none: {} },
              },
            },
          },
          select: {
            status: true,
            summon: {
              select: {
                id: true,
                trainingSession: {
                  select: {
                    id: true,
                    heldAt: true,
                    location: true,
                    instructorName: true,
                    durationMinutes: true,
                  },
                },
              },
            },
          },
        });
        const proxima = chamadas
          .filter((c) => c.summon.trainingSession)
          .sort(
            (a, b) =>
              a.summon.trainingSession!.heldAt.getTime() -
              b.summon.trainingSession!.heldAt.getTime(),
          )[0];
        if (proxima) {
          const turma = proxima.summon.trainingSession!;
          minhaTurma = {
            id: turma.id,
            held_at: turma.heldAt,
            location: turma.location,
            instructor_name: turma.instructorName,
            duration_minutes: turma.durationMinutes,
            summon_id: proxima.summon.id,
            attendance_status: proxima.status,
          };
        }
      }

      res.json({
        training: {
          ...training,
          my_session: minhaTurma,
          my_enrollment: minha
            ? {
                ...minha,
                /** Vale até vencer, mas abaixo da nota de hoje. [CB-31] */
                below_minimum:
                  minha.status === ENROLLMENT_STATUSES.COMPLETED &&
                  minha.score !== null &&
                  minha.score < training.passingScore,
                /** A tela mostra "Refazer o treinamento". [CB-65] */
                can_retake: podeRefazer(minha, training.passingScore),
              }
            : null,
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
        select: {
          id: true,
          title: true,
          validityMonths: true,
          passingScore: true,
        },
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
      /*
        Certificado emitido antes de existir nota mínima, com nota abaixo
        dela: vale até vencer, mas sai marcado — a lista não podia tratá-lo
        como igual aos outros. [CB-31]
      */
      res.json({
        training,
        enrollments: rows.map((r) => ({
          ...r,
          below_minimum:
            r.status === ENROLLMENT_STATUSES.COMPLETED &&
            r.score !== null &&
            r.score < training.passingScore,
        })),
      });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * O certificado como documento, não como código solto.
   *
   * A pessoa via o número e a validade e não tinha o que abrir, imprimir ou
   * entregar; a empresa emitia o certificado fora do portal para mostrar à
   * fiscalização. Isto devolve o que vai no papel: quem fez, o quê, quando,
   * por quanto tempo vale, e — no presencial — a turma, a carga horária e o
   * instrutor com o registro dele. [B2-3-C]
   */
  async certificate(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);

      const enrollment = await prisma.trainingEnrollment.findFirst({
        where: { id: req.params.enrollmentId, training: { organizationId: orgId } },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              employeeProfiles: {
                where: { organizationId: orgId },
                take: 1,
                select: { registration: true, jobRole: { select: { name: true } } },
              },
            },
          },
          training: {
            select: {
              id: true,
              title: true,
              kind: true,
              summary: true,
              durationMinutes: true,
              passingScore: true,
              validityMonths: true,
              instructorName: true,
              instructorQualification: true,
              technicalResponsibleName: true,
              technicalResponsibleQualification: true,
            },
          },
        },
      });
      if (!enrollment) {
        res.status(404).json({ message: "Certificado não encontrado." });
        return;
      }
      /*
        O certificado é da pessoa. Quem cuida de Treinamentos também abre,
        porque é quem entrega o papel e quem mostra à fiscalização.
        [B2-3-C] [S7-A]
      */
      const cuida =
        auth.actor && canSeeAllInModule(auth.actor.permission, "treinamentos");
      if (enrollment.userId !== userId && !cuida) {
        res.status(403).json({ message: "Este certificado é de outra pessoa." });
        return;
      }
      if (
        enrollment.status !== ENROLLMENT_STATUSES.COMPLETED ||
        !enrollment.certificateCode
      ) {
        res.status(409).json({
          message: "Este treinamento ainda não foi concluído.",
          code: "NO_CERTIFICATE",
        });
        return;
      }

      // Presencial: a turma é que diz a data, a carga horária e o instrutor.
      const turma =
        enrollment.training.kind === TrainingKind.CLASSROOM
          ? await prisma.trainingAttendance.findFirst({
              where: {
                userId: enrollment.userId,
                present: true,
                session: { trainingId: enrollment.trainingId },
              },
              orderBy: { createdAt: "desc" },
              include: {
                session: {
                  select: {
                    heldAt: true,
                    durationMinutes: true,
                    location: true,
                    instructorName: true,
                    instructorRegistration: true,
                    instructorQualification: true,
                  },
                },
              },
            })
          : null;

      const ficha = enrollment.user.employeeProfiles[0] ?? null;
      const organizacao = await prisma.organization.findFirst({
        where: { id: orgId },
        select: { name: true, taxId: true },
      });

      res.json({
        certificate: {
          code: enrollment.certificateCode,
          completed_at: enrollment.completedAt,
          expires_at: enrollment.expiresAt,
          score: enrollment.score,
          passing_score: enrollment.training.passingScore,
          below_minimum:
            enrollment.score !== null &&
            enrollment.score < enrollment.training.passingScore,
          person: {
            name: enrollment.user.name,
            registration: ficha?.registration ?? null,
            job_role: ficha?.jobRole?.name ?? null,
          },
          training: {
            title: enrollment.training.title,
            kind: enrollment.training.kind,
            summary: enrollment.training.summary,
            duration_minutes:
              turma?.session.durationMinutes ?? enrollment.training.durationMinutes,
            validity_months: enrollment.training.validityMonths,
            /*
              O certificado pede quem ministrou, com a qualificação, e a
              assinatura do responsável técnico (NR-1 1.7.1.1). No curso a
              distância, quem ministra vem do cadastro. [B3-3-G]
            */
            instructor_name: enrollment.training.instructorName,
            instructor_qualification: enrollment.training.instructorQualification,
            technical_responsible_name: enrollment.training.technicalResponsibleName,
            technical_responsible_qualification:
              enrollment.training.technicalResponsibleQualification,
          },
          session: turma
            ? {
                held_at: turma.session.heldAt,
                location: turma.session.location,
                instructor_name: turma.session.instructorName,
                instructor_registration: turma.session.instructorRegistration,
                instructor_qualification: turma.session.instructorQualification,
              }
            : null,
          organization: organizacao,
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
        kind,
        passing_score,
        summary,
        duration_minutes,
        points,
        video_url,
        validity_months,
        slides,
        questions,
        instructor_name,
        instructor_qualification,
        technical_responsible_name,
        technical_responsible_qualification,
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
        /** O que o certificado pede (1.7.1.1). [B3-3-G] */
        instructor_name?: string;
        instructor_qualification?: string;
        technical_responsible_name?: string;
        technical_responsible_qualification?: string;
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
            instructorName: blank(instructor_name),
            instructorQualification: blank(instructor_qualification),
            technicalResponsibleName: blank(technical_responsible_name),
            technicalResponsibleQualification: blank(technical_responsible_qualification),
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

      /*
        Começar de novo um curso concluído não rebaixa a inscrição: o
        certificado continua valendo enquanto a pessoa refaz. [CB-65]
      */
      const atual = await prisma.trainingEnrollment.findUnique({
        where: { trainingId_userId: { trainingId: training.id, userId } },
      });
      if (atual?.status === ENROLLMENT_STATUSES.COMPLETED) {
        res.json({ enrollment: atual });
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
      /*
        Certificado emitido antes de existir nota mínima, com nota abaixo
        dela, continua valendo até vencer — mas a pessoa precisa poder
        refazer, e antes ouvia "Treinamento já concluído". [CB-31]
      */
      const refazendo = enrollment.status === ENROLLMENT_STATUSES.COMPLETED;
      if (refazendo && !podeRefazer(enrollment, training.passingScore)) {
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
      /*
        Quem refaz e não passa fica com o certificado que já tinha: ele vale
        até vencer, e a tentativa nova não o apaga. [CB-65]
      */
      if (!passed && refazendo) {
        const aindaVale =
          enrollment.expiresAt === null || enrollment.expiresAt.getTime() >= Date.now();
        res.json({
          enrollment,
          passed: false,
          passing_score: training.passingScore,
          message: `Você acertou ${score}% e a nota mínima é ${training.passingScore}%.${
            aindaVale ? " O certificado que você já tem continua valendo até vencer." : ""
          } Reveja o conteúdo e tente de novo.`,
        });
        return;
      }
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
  /**
   * A lista de presença de uma turma que já foi marcada.
   *
   * A turma agendada existe antes da aula, sem presença; depois que ela
   * acontece, é aqui que se diz quem esteve — e é isso que gera o
   * certificado. [CB-34]
   */
  async recordAttendance(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      if (!isRh(auth)) {
        res.status(403).json({ message: "Sem permissão para registrar presença." });
        return;
      }

      const session = await prisma.trainingSession.findFirst({
        where: {
          id: req.params.sessionId,
          organizationId: orgId,
          trainingId: req.params.id,
        },
        include: {
          training: {
            select: { id: true, passingScore: true, validityMonths: true },
          },
          attendances: { select: { userId: true } },
        },
      });
      if (!session) {
        res.status(404).json({ message: "Turma não encontrada." });
        return;
      }
      if (session.attendances.length > 0) {
        res.status(409).json({
          message: "Esta turma já tem lista de presença.",
          code: "ATTENDANCE_ALREADY_RECORDED",
        });
        return;
      }
      if (session.heldAt.getTime() > Date.now()) {
        res.status(409).json({
          message: "A turma ainda não aconteceu — registre a presença depois da aula.",
          code: "SESSION_NOT_HELD_YET",
        });
        return;
      }

      const body = req.body as {
        attendees?: Array<{ user_id?: string; present?: boolean; score?: number }>;
      };
      const lista = Array.isArray(body.attendees) ? body.attendees : [];
      const ids = [
        ...new Set(lista.map((a) => String(a.user_id ?? "")).filter(Boolean)),
      ];
      if (ids.length === 0) {
        res.status(400).json({ message: "Informe quem esteve na turma." });
        return;
      }
      const membros = await prisma.membership.findMany({
        where: {
          organizationId: orgId,
          userId: { in: ids },
          suspendedAt: null,
          user: { active: true },
        },
        select: { userId: true },
      });
      const membroValido = new Set(membros.map((m) => m.userId));
      if (ids.some((id) => !membroValido.has(id))) {
        res.status(400).json({ message: "Há pessoas na lista que não são da empresa." });
        return;
      }

      await prisma.$transaction(async (tx) => {
        for (const entrada of lista) {
          const alvo = String(entrada.user_id ?? "");
          if (!alvo || !membroValido.has(alvo)) continue;
          const presente = entrada.present !== false;
          const nota =
            typeof entrada.score === "number" && Number.isFinite(entrada.score)
              ? Math.max(0, Math.min(100, Math.round(entrada.score)))
              : null;

          await tx.trainingAttendance.upsert({
            where: { sessionId_userId: { sessionId: session.id, userId: alvo } },
            create: { sessionId: session.id, userId: alvo, present: presente, score: nota },
            update: { present: presente, score: nota },
          });
          if (!presente) continue;

          const passou = nota === null || nota >= session.training.passingScore;
          await tx.trainingEnrollment.upsert({
            where: {
              trainingId_userId: { trainingId: session.training.id, userId: alvo },
            },
            create: {
              trainingId: session.training.id,
              userId: alvo,
              status: passou
                ? ENROLLMENT_STATUSES.COMPLETED
                : ENROLLMENT_STATUSES.FAILED,
              startedAt: session.heldAt,
              completedAt: passou ? session.heldAt : null,
              score: nota,
              certificateCode: passou
                ? `TR-${randomBytes(4).toString("hex").toUpperCase()}`
                : null,
              expiresAt: passou ? expiryFrom(session.training.validityMonths) : null,
            },
            update: {
              status: passou
                ? ENROLLMENT_STATUSES.COMPLETED
                : ENROLLMENT_STATUSES.FAILED,
              startedAt: session.heldAt,
              completedAt: passou ? session.heldAt : null,
              score: nota,
              ...(passou
                ? { expiresAt: expiryFrom(session.training.validityMonths) }
                : { certificateCode: null, expiresAt: null }),
            },
          });
        }
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "training_session.attendance",
        entityType: "TrainingSession",
        entityId: session.id,
        after: { attendees: ids.length },
      });

      res.json({ ok: true, attendees: ids.length });
    } catch (err) {
      fail(res, err);
    }
  }

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
        select: {
          id: true,
          title: true,
          kind: true,
          durationMinutes: true,
          passingScore: true,
          validityMonths: true,
        },
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
        /** Qualificação de quem deu a aula, para o certificado. [B3-3-G] */
        instructor_qualification?: string;
        location?: string;
        duration_minutes?: number;
        notes?: string;
        attendees?: Array<{ user_id?: string; present?: boolean; score?: number }>;
        /** Quem convocar para a turma agendada. [CB-34] */
        invite_user_ids?: string[];
      };

      const tituloDoTreinamento = training.title;
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
      /*
        A turma só podia ser registrada depois de acontecer: não havia como
        agendar nem convocar ninguém antes. Agora data no futuro é
        agendamento — sem lista de presença, que entra depois da aula. [CB-34]
      */
      const agendada = heldAt.getTime() > Date.now();
      const duracao = body.duration_minutes ?? training.durationMinutes;
      if (!Number.isInteger(duracao) || duracao <= 0) {
        res.status(400).json({ message: "Informe a carga horária em minutos." });
        return;
      }

      const lista = Array.isArray(body.attendees) ? body.attendees : [];
      const ids = [...new Set(lista.map((a) => String(a.user_id ?? "")).filter(Boolean))];
      if (!agendada && ids.length === 0) {
        res.status(400).json({ message: "Informe quem esteve na turma." });
        return;
      }
      if (agendada && ids.length > 0) {
        res.status(400).json({
          message:
            "A turma ainda não aconteceu: a lista de presença entra depois da aula.",
          code: "SESSION_NOT_HELD_YET",
        });
        return;
      }

      /*
        Convocar antes: quem for chamado recebe o aviso e fica registrado na
        convocação, que é a tela que a empresa já usa para isso. [CB-34]
      */
      const convocados = [
        ...new Set(
          (Array.isArray(body.invite_user_ids) ? body.invite_user_ids : [])
            .map((x) => String(x ?? ""))
            .filter(Boolean),
        ),
      ];
      const todos = [...new Set([...ids, ...convocados])];
      const membros = await prisma.membership.findMany({
        where: {
          organizationId: orgId,
          userId: { in: todos },
          suspendedAt: null,
          user: { active: true },
        },
        select: { userId: true },
      });
      const membroValido = new Set(membros.map((m) => m.userId));
      const forasteiros = todos.filter((id) => !membroValido.has(id));
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
            instructorQualification: blank(body.instructor_qualification),
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

        /*
          Convocação: quem foi chamado fica registrado e recebe o aviso.
          Reusa a Convocações, que é a tela que a empresa já usa. [CB-34]
        */
        if (convocados.length > 0) {
          const convocacao = await tx.summon.create({
            data: {
              organizationId: orgId,
              title: `Treinamento: ${tituloDoTreinamento}`,
              description: blank(body.notes),
              scheduledFor: heldAt,
              location: blank(body.location),
              createdById: userId,
              /* O convocado abre o treinamento e vê a turma. [B3-3-C] */
              trainingSessionId: criada.id,
            },
          });
          for (const alvo of convocados) {
            if (!membroValido.has(alvo)) continue;
            await tx.summonAttendance.create({
              data: { summonId: convocacao.id, userId: alvo },
            });
          }
        }

        return criada;
      });

      if (convocados.length > 0) {
        await notifyMany(
          convocados.filter((id) => membroValido.has(id)),
          {
            organizationId: orgId,
            kind: NotificationKind.TRAINING_SCHEDULED,
            title: `Treinamento: ${tituloDoTreinamento}`,
            body: `Turma marcada para ${formatCalendarDayTime(heldAt)}${
              blank(body.location) ? ` em ${blank(body.location)}` : ""
            }.`,
            /*
              O aviso levava a Convocações, e quem abria o treinamento não
              via a turma. Agora leva ao treinamento, onde ela aparece. [B3-3-C]
            */
            link: `/treinamentos/${training.id}`,
            entityType: "TrainingSession",
            entityId: session.id,
          },
        );
      }

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
          instructor_qualification: s.instructorQualification,
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

  /**
   * O que o certificado pede, nos treinamentos já cadastrados: quem
   * ministra, com a qualificação, e o responsável técnico. O treinamento não
   * se editava depois de criado, e sem isto os que existem nunca teriam esses
   * dados. Campo que não vem fica como está; campo vazio apaga. [B3-3-G]
   */
  async updateCertificateData(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const atual = await prisma.training.findFirst({
        where: { id: req.params.id, organizationId: orgId, archivedAt: null },
        select: {
          id: true,
          instructorName: true,
          instructorQualification: true,
          technicalResponsibleName: true,
          technicalResponsibleQualification: true,
        },
      });
      if (!atual) {
        res.status(404).json({ message: "Treinamento não encontrado." });
        return;
      }
      const body = req.body as Record<string, unknown>;
      const campos = {
        instructor_name: "instructorName",
        instructor_qualification: "instructorQualification",
        technical_responsible_name: "technicalResponsibleName",
        technical_responsible_qualification: "technicalResponsibleQualification",
      } as const;
      const data: Partial<Record<(typeof campos)[keyof typeof campos], string | null>> = {};
      for (const [chave, coluna] of Object.entries(campos)) {
        if (!(chave in body)) continue;
        const v = body[chave];
        if (v !== null && typeof v !== "string") {
          res.status(400).json({ message: `${chave} deve ser texto.` });
          return;
        }
        data[coluna] = blank(v);
      }
      const training = await prisma.training.update({
        where: { id: atual.id },
        data,
        select: {
          id: true,
          instructorName: true,
          instructorQualification: true,
          technicalResponsibleName: true,
          technicalResponsibleQualification: true,
        },
      });
      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "training.certificate_data",
        entityType: "Training",
        entityId: atual.id,
        before: {
          instructorName: atual.instructorName,
          instructorQualification: atual.instructorQualification,
          technicalResponsibleName: atual.technicalResponsibleName,
          technicalResponsibleQualification: atual.technicalResponsibleQualification,
        },
        after: training,
      });
      res.json({ training });
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
