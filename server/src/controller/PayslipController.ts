import { Prisma } from "@prisma/client";
import fs from "fs";
import { NotificationKind } from "@prisma/client";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { Payslip } from "../model/schema/Payslip/Payslip";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { notify } from "../helper/notify";
import { canManageModule } from "../helper/module-access";
import { checkPayslip } from "../helper/payslip-check";
import { extractPdfText } from "../helper/pdf-text";
import {
  assertSize,
  buildPrivateStoragePath,
  resolveStoragePath,
  writeEvidenceFile,
} from "../helper/uploads";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    res.status(409).json({
      message: "Já existe holerite para este colaborador neste mês/ano.",
    });
    return;
  }
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function isRh(req: AuthRequest): boolean {
  return Boolean(req.actor && canManageModule(req.actor.permission, "holerites"));
}

class PayslipController {
  async listRecipients(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      if (!isRh(auth)) {
        res.status(403).json({ message: "Sem permissão." });
        return;
      }
      const orgId = actorOrgId(auth);
      const rows = await prisma.membership.findMany({
        where: {
          organizationId: orgId,
          user: { active: true },
        },
        include: {
          user: { select: { id: true, name: true, login: true } },
        },
      });
      const recipients = rows
        .map((r) => r.user)
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      res.json({ recipients });
    } catch (err) {
      fail(res, err);
    }
  }

  async list(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const year = req.query.year ? Number(req.query.year) : undefined;

      const rows = await prisma.payslip.findMany({
        where: {
          organizationId: orgId,
          ...(!isRh(auth) ? { userId } : {}),
          ...(req.query.user_id && isRh(auth)
            ? { userId: String(req.query.user_id) }
            : {}),
          ...(year ? { referenceYear: year } : {}),
        },
        orderBy: [{ referenceYear: "desc" }, { referenceMonth: "desc" }],
        include: {
          user: { select: { id: true, name: true } },
          publishedBy: { select: { id: true, name: true } },
          _count: { select: { questions: true } },
          questions: {
            where: { answer: null },
            select: { id: true },
          },
        },
      });
      res.json({
        payslips: rows.map((r) => {
          const { storagePath: _storagePath, questions: _questions, ...rest } = r;
          return {
            ...rest,
            open_questions: r.questions.length,
          };
        }),
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
      const payslip = await prisma.payslip.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: {
          user: { select: { id: true, name: true } },
          publishedBy: { select: { id: true, name: true } },
          questions: {
            orderBy: { createdAt: "asc" },
            include: {
              askedBy: { select: { id: true, name: true } },
              answeredBy: { select: { id: true, name: true } },
            },
          },
          /** As versões anteriores, que deixaram de ser apagadas. [S5-F] */
          versions: {
            orderBy: { replacedAt: "desc" },
            select: {
              id: true,
              fileName: true,
              publishedAt: true,
              viewedAt: true,
              replacedAt: true,
              replacedBy: { select: { id: true, name: true } },
            },
          },
          overriddenBy: { select: { id: true, name: true } },
        },
      });
      if (!payslip) {
        res.status(404).json({ message: "Holerite não encontrado." });
        return;
      }
      if (payslip.userId !== userId) {
        res.status(403).json({
          message: "Só o titular pode abrir o holerite.",
        });
        return;
      }
      /*
        "Visto" era marcado ao abrir o detalhe: entrar na tela e voltar sem
        abrir o arquivo já contava como visto. O que prova entrega é abrir o
        documento, e isso acontece no download. [S4-E]
      */
      res.json({ payslip });
    } catch (err) {
      fail(res, err);
    }
  }

  async download(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const payslip = await prisma.payslip.findFirst({
        where: { id: req.params.id, organizationId: orgId },
      });
      if (!payslip) {
        res.status(404).json({ message: "Holerite não encontrado." });
        return;
      }
      if (payslip.userId !== userId) {
        res.status(403).json({
          message: "Só o titular pode baixar o holerite.",
        });
        return;
      }
      const abs = resolveStoragePath(payslip.storagePath);
      if (!fs.existsSync(abs)) {
        res.status(404).json({ message: "Arquivo não encontrado." });
        return;
      }
      if (!payslip.viewedAt) {
        await prisma.payslip.update({
          where: { id: payslip.id },
          data: { viewedAt: new Date() },
        });
      }
      res.download(abs, payslip.fileName);
    } catch (err) {
      fail(res, err);
    }
  }

  /** Dúvidas em aberto — RH responde sem abrir o arquivo do holerite. */
  async listOpenQuestions(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      if (!isRh(auth)) {
        res.status(403).json({ message: "Sem permissão." });
        return;
      }
      const orgId = actorOrgId(auth);
      const rows = await prisma.payslipQuestion.findMany({
        where: {
          answer: null,
          payslip: { organizationId: orgId },
        },
        orderBy: { createdAt: "asc" },
        include: {
          askedBy: { select: { id: true, name: true } },
          payslip: {
            select: {
              id: true,
              referenceMonth: true,
              referenceYear: true,
              fileName: true,
              user: { select: { id: true, name: true } },
            },
          },
        },
      });
      res.json({
        questions: rows.map((q) => ({
          id: q.id,
          body: q.body,
          created_at: q.createdAt,
          asked_by: q.askedBy,
          payslip_id: q.payslip.id,
          reference_month: q.payslip.referenceMonth,
          reference_year: q.payslip.referenceYear,
          file_name: q.payslip.fileName,
          user: q.payslip.user,
        })),
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async create(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const publisherId = actorUserId(auth);
      const {
        user_id,
        reference_month,
        reference_year,
        file_name,
        mime_type,
        content_base64,
        override_reason,
      } = req.body as {
        user_id?: string;
        reference_month?: number;
        reference_year?: number;
        file_name?: string;
        mime_type?: string;
        content_base64?: string;
        /** Por que publicar apesar de o documento não conferir. [CB-28] */
        override_reason?: string;
      };

      if (
        !user_id ||
        !reference_month ||
        !reference_year ||
        !file_name?.trim() ||
        !mime_type
      ) {
        res.status(400).json({
          message:
            "Informe user_id, reference_month, reference_year, file_name e mime_type.",
        });
        return;
      }
      if (reference_month < 1 || reference_month > 12) {
        res.status(400).json({ message: "reference_month deve ser 1–12." });
        return;
      }
      if (!content_base64) {
        res.status(400).json({ message: "Informe content_base64." });
        return;
      }

      const membership = await prisma.membership.findFirst({
        where: { userId: user_id, organizationId: orgId },
      });
      if (!membership) {
        res.status(400).json({ message: "Colaborador inválido." });
        return;
      }

      const data = Buffer.from(content_base64, "base64");
      assertSize(data.length || 0);

      /*
        Confere o DOCUMENTO antes de publicar: o nome do arquivo e a escolha da
        pessoa na tela não provam de quem é o holerite. Três travas lidas do
        PDF — matrícula, nome e competência — e a admissão como confirmação.
        [S5-G]
      */
      const destinatario = await prisma.user.findFirst({
        where: { id: user_id },
        select: {
          name: true,
          employeeProfiles: {
            where: { organizationId: orgId },
            select: { registration: true, admittedAt: true },
            take: 1,
          },
        },
      });
      const ficha = destinatario?.employeeProfiles?.[0];
      if (!destinatario || !ficha?.registration) {
        res.status(422).json({
          message:
            "Sem matrícula no cadastro não dá para conferir o holerite. Complete o cadastro do colaborador antes de publicar.",
        });
        return;
      }

      const conferencia = checkPayslip(await extractPdfText(data), {
        registration: ficha.registration,
        name: destinatario.name,
        referenceMonth: reference_month,
        referenceYear: reference_year,
        admittedAt: ficha.admittedAt ?? null,
      });
      /*
        A conferência pegou um erro real e não pode cair. Mas holerite correto
        de outra contabilidade, ou digitalizado, travava o RH para sempre:
        agora dá para publicar assim mesmo dizendo por quê, e quem publicou e
        o motivo ficam gravados. A tela mostra o que não conferiu, em vez de
        só "não confere". [CB-28] [B2-3-B]
      */
      /*
        O motivo só vale — e só fica gravado — quando a conferência de fato
        recusou. Mandar um motivo num holerite que confere não pode marcar o
        documento como exceção.
      */
      const motivoForaDoPadrao = conferencia.ok
        ? null
        : override_reason?.trim() || null;
      if (!conferencia.ok && !motivoForaDoPadrao) {
        res.status(422).json({
          message: "O documento não confere com a pessoa escolhida.",
          code: "PAYSLIP_CHECK_FAILED",
          reasons: conferencia.blockers,
        });
        return;
      }

      const { storagePath, absolutePath } = buildPrivateStoragePath(
        orgId,
        "payslips",
        mime_type,
      );
      writeEvidenceFile(absolutePath, data);

      const existing = await prisma.payslip.findFirst({
        where: {
          organizationId: orgId,
          userId: user_id,
          referenceMonth: reference_month,
          referenceYear: reference_year,
        },
      });

      let payslip;
      if (existing) {
        /*
          A versão de antes deixa de ser apagada: ela vira histórico, com o
          arquivo no lugar e a data em que a pessoa a abriu. É o que prova o
          que foi entregue antes da correção. [S5-F]
        */
        payslip = await prisma.$transaction(async (tx) => {
          await tx.payslipVersion.create({
            data: {
              payslipId: existing.id,
              storagePath: existing.storagePath,
              fileName: existing.fileName,
              publishedById: existing.publishedById,
              publishedAt: existing.publishedAt,
              viewedAt: existing.viewedAt,
              replacedById: publisherId,
            },
          });
          return tx.payslip.update({
            where: { id: existing.id },
            data: {
              storagePath,
              fileName: file_name.trim(),
              publishedById: publisherId,
              publishedAt: new Date(),
              viewedAt: null,
              overrideReason: motivoForaDoPadrao,
              overriddenById: motivoForaDoPadrao ? publisherId : null,
            },
          });
        });
        await writeAudit({
          organizationId: orgId,
          actorId: publisherId,
          action: "payslip.replace",
          entityType: "Payslip",
          entityId: payslip.id,
          before: { fileName: existing.fileName, viewedAt: existing.viewedAt },
          after: { fileName: payslip.fileName },
        });
      } else {
        payslip = await new Payslip().create.new({
          organizationId: orgId,
          userId: user_id,
          referenceMonth: reference_month,
          referenceYear: reference_year,
          storagePath,
          fileName: file_name.trim(),
          publishedById: publisherId,
          overrideReason: motivoForaDoPadrao,
          overriddenById: motivoForaDoPadrao ? publisherId : null,
        });
        await writeAudit({
          organizationId: orgId,
          actorId: publisherId,
          action: "payslip.create",
          entityType: "Payslip",
          entityId: payslip.id,
        });
      }

      // Holerite publicado e ninguém sabia: a pessoa tinha de entrar na
      // tela para descobrir. [CB-29]
      await notify({
        organizationId: orgId,
        userId: user_id,
        kind: NotificationKind.PAYSLIP_PUBLISHED,
        title: `Holerite de ${String(reference_month).padStart(2, "0")}/${reference_year}`,
        body: existing
          ? "O holerite foi corrigido e está disponível."
          : "Seu holerite está disponível.",
        link: "/holerites",
        entityType: "Payslip",
        entityId: payslip.id,
      });

      res.status(existing ? 200 : 201).json({
        warnings: conferencia.warnings,
        /** O que não conferiu, quando foi publicado assim mesmo. [CB-28] */
        overridden_reasons: motivoForaDoPadrao ? conferencia.blockers : [],
        payslip,
        replaced: Boolean(existing),
      });
    } catch (err) {
      fail(res, err);
    }
  }

  /** Baixar a versão que foi substituída — a que a pessoa viu antes. [S5-F] */
  async downloadVersion(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const versao = await prisma.payslipVersion.findFirst({
        where: { id: req.params.versionId, payslip: { organizationId: orgId } },
        include: { payslip: { select: { userId: true } } },
      });
      if (!versao) {
        res.status(404).json({ message: "Versão não encontrada." });
        return;
      }
      if (versao.payslip.userId !== userId) {
        res.status(403).json({ message: "Só o titular pode baixar o holerite." });
        return;
      }
      const abs = resolveStoragePath(versao.storagePath);
      if (!fs.existsSync(abs)) {
        res.status(404).json({ message: "Arquivo não encontrado." });
        return;
      }
      res.download(abs, versao.fileName);
    } catch (err) {
      fail(res, err);
    }
  }

  async askQuestion(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const payslip = await new Payslip().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!payslip) {
        res.status(404).json({ message: "Holerite não encontrado." });
        return;
      }
      if (payslip.userId !== userId) {
        res.status(403).json({
          message: "Só o titular do holerite pode perguntar.",
        });
        return;
      }
      const { body } = req.body as { body?: string };
      if (!body?.trim()) {
        res.status(400).json({ message: "Informe body." });
        return;
      }
      const question = await prisma.payslipQuestion.create({
        data: {
          payslipId: payslip.id,
          askedById: userId,
          body: body.trim(),
        },
        include: {
          askedBy: { select: { id: true, name: true } },
          answeredBy: { select: { id: true, name: true } },
        },
      });
      res.status(201).json({ question });
    } catch (err) {
      fail(res, err);
    }
  }

  async answerQuestion(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const question = await prisma.payslipQuestion.findFirst({
        where: {
          id: req.params.questionId,
          payslipId: req.params.id,
          payslip: { organizationId: orgId },
        },
      });
      if (!question) {
        res.status(404).json({ message: "Pergunta não encontrada." });
        return;
      }
      const { answer } = req.body as { answer?: string };
      if (!answer?.trim()) {
        res.status(400).json({ message: "Informe answer." });
        return;
      }
      const updated = await prisma.payslipQuestion.update({
        where: { id: question.id },
        data: {
          answer: answer.trim(),
          answeredById: userId,
          answeredAt: new Date(),
        },
        include: {
          askedBy: { select: { id: true, name: true } },
          answeredBy: { select: { id: true, name: true } },
        },
      });
      // Quem perguntou precisa saber que foi respondido. [S5-E] [CB-29]
      if (question.askedById !== userId) {
        await notify({
          organizationId: orgId,
          userId: question.askedById,
          kind: NotificationKind.PAYSLIP_ANSWERED,
          title: "O RH respondeu a sua dúvida do holerite",
          body: answer.trim().slice(0, 140),
          link: "/holerites",
          entityType: "PayslipQuestion",
          entityId: question.id,
        });
      }

      res.json({ question: updated });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new PayslipController();
