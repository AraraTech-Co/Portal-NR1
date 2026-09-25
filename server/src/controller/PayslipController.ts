import { Prisma } from "@prisma/client";
import fs from "fs";
import path from "path";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { Payslip } from "../model/schema/Payslip/Payslip";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { can } from "../helper/permissions";
import {
  assertSize,
  buildPrivateStoragePath,
  uploadsRoot,
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
  return Boolean(req.actor && can(req.actor.permission, "rh"));
}

function absoluteStoragePath(storagePath: string): string {
  const root = path.resolve(uploadsRoot());
  const abs = path.resolve(root, storagePath);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    throw Object.assign(new Error("Caminho inválido."), { status: 400 });
  }
  return abs;
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
        payslips: rows.map((r) => ({
          ...r,
          open_questions: r.questions.length,
          questions: undefined,
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
      if (!payslip.viewedAt) {
        await prisma.payslip.update({
          where: { id: payslip.id },
          data: { viewedAt: new Date() },
        });
        payslip.viewedAt = new Date();
      }
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
      const abs = absoluteStoragePath(payslip.storagePath);
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
      } = req.body as {
        user_id?: string;
        reference_month?: number;
        reference_year?: number;
        file_name?: string;
        mime_type?: string;
        content_base64?: string;
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
        const oldAbs = absoluteStoragePath(existing.storagePath);
        payslip = await prisma.payslip.update({
          where: { id: existing.id },
          data: {
            storagePath,
            fileName: file_name.trim(),
            publishedById: publisherId,
            publishedAt: new Date(),
            viewedAt: null,
          },
        });
        if (fs.existsSync(oldAbs) && oldAbs !== absolutePath) {
          fs.unlinkSync(oldAbs);
        }
        await writeAudit({
          organizationId: orgId,
          actorId: publisherId,
          action: "payslip.replace",
          entityType: "Payslip",
          entityId: payslip.id,
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
        });
        await writeAudit({
          organizationId: orgId,
          actorId: publisherId,
          action: "payslip.create",
          entityType: "Payslip",
          entityId: payslip.id,
        });
      }

      res.status(existing ? 200 : 201).json({
        payslip,
        replaced: Boolean(existing),
      });
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
      res.json({ question: updated });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new PayslipController();
