import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { EthicsReport } from "../model/schema/EthicsReport/EthicsReport";
import { EthicsReportMessage } from "../model/schema/EthicsReportMessage/EthicsReportMessage";
import { Establishment } from "../model/schema/Establishment/Establishment";
import { Hazard } from "../model/schema/Hazard/Hazard";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import {
  ETHICS_ACCESS_CODE_BCRYPT_ROUNDS,
  ETHICS_ACCESS_CODE_LENGTH,
  ETHICS_PROTOCOL_PREFIX,
  REPORT_AUTHOR_SIDES,
  REPORT_CATEGORY_VALUES,
  REPORT_STATUSES,
  REPORT_STATUS_VALUES,
  isReportCategory,
  isReportStatus,
} from "../constants";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function blank(v?: string | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

function generateAccessCode(): string {
  // Base64url sem padding — legível para copiar uma vez.
  return randomBytes(Math.ceil((ETHICS_ACCESS_CODE_LENGTH * 3) / 4))
    .toString("base64url")
    .slice(0, ETHICS_ACCESS_CODE_LENGTH)
    .toUpperCase();
}

async function allocateProtocol(organizationId: string): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const n = 1000 + Math.floor(Math.random() * 9000);
    const protocol = `${ETHICS_PROTOCOL_PREFIX}-${n}`;
    const exists = await prisma.ethicsReport.findFirst({
      where: { organizationId, protocol },
      select: { id: true },
    });
    if (!exists) return protocol;
  }
  throw Object.assign(new Error("Não foi possível gerar protocolo único."), {
    status: 500,
  });
}

/** Resposta segura para quem acompanha por protocolo (sem hash, sem autor do comitê). */
function publicReportView(report: {
  id: string;
  protocol: string;
  category: string;
  description: string;
  isAnonymous: boolean;
  status: string;
  resolutionNote: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  messages?: Array<{
    id: string;
    side: string;
    body: string;
    createdAt: Date;
  }>;
}) {
  return {
    id: report.id,
    protocol: report.protocol,
    category: report.category,
    description: report.description,
    isAnonymous: report.isAnonymous,
    status: report.status,
    resolutionNote: report.resolutionNote,
    resolvedAt: report.resolvedAt,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    messages: report.messages?.map((m) => ({
      id: m.id,
      side: m.side,
      body: m.body,
      createdAt: m.createdAt,
    })),
  };
}

async function findByProtocolAndCode(
  organizationId: string | undefined,
  protocol: string,
  accessCode: string,
) {
  const where = {
    protocol: protocol.trim().toUpperCase(),
    ...(organizationId ? { organizationId } : {}),
  };
  const candidates = await prisma.ethicsReport.findMany({
    where,
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  for (const report of candidates) {
    const ok = await bcrypt.compare(accessCode, report.accessCodeHash);
    if (ok) return report;
  }
  return null;
}

class EthicsController {
  /**
   * Abre relato. Anônimo por padrão: não grava reporterUserId.
   * Auth opcional (verify public). Sem auth, exige organization_id.
   * Devolve access_code em claro UMA vez.
   */
  async create(req: Request, res: Response) {
    try {
      const authReq = req as AuthRequest;
      const {
        organization_id,
        category,
        description,
        is_anonymous,
        establishment_id,
      } = req.body as {
        organization_id?: string;
        category?: string;
        description?: string;
        is_anonymous?: boolean;
        establishment_id?: string;
      };

      const orgId =
        authReq.actor?.organizationId ?? organization_id ?? null;
      if (!orgId) {
        res.status(400).json({
          message: "Informe organization_id (ou autentique-se).",
        });
        return;
      }

      if (!category || !description?.trim()) {
        res.status(400).json({
          message: "Informe category e description.",
        });
        return;
      }
      if (!isReportCategory(category)) {
        res.status(400).json({
          message: `category inválida. Use: ${REPORT_CATEGORY_VALUES.join(", ")}.`,
        });
        return;
      }

      const org = await prisma.organization.findFirst({
        where: { id: orgId, active: true },
      });
      if (!org) {
        res.status(404).json({ message: "Organização não encontrada." });
        return;
      }

      if (establishment_id) {
        const est = await new Establishment().read.one({
          id: establishment_id,
          organizationId: orgId,
          archivedAt: null,
        });
        if (!est) {
          res.status(400).json({ message: "Estabelecimento inválido." });
          return;
        }
      }

      const anonymous = is_anonymous !== false;
      if (!anonymous && !authReq.actor) {
        res.status(401).json({
          message:
            "Para denúncia identificada, autentique-se no portal.",
        });
        return;
      }
      const reporterUserId =
        !anonymous && authReq.actor ? authReq.actor.userId : null;

      const protocol = await allocateProtocol(orgId);
      const accessCode = generateAccessCode();
      const accessCodeHash = await bcrypt.hash(
        accessCode,
        ETHICS_ACCESS_CODE_BCRYPT_ROUNDS,
      );

      const report = await new EthicsReport().create.new({
        organizationId: orgId,
        protocol,
        category,
        description: description.trim(),
        isAnonymous: anonymous,
        reporterUserId,
        accessCodeHash,
        status: REPORT_STATUSES.RECEIVED,
        establishmentId: establishment_id ?? null,
      });

      // Auditoria sem revelar identidade do denunciante anônimo.
      await writeAudit({
        organizationId: orgId,
        actorId: anonymous ? null : reporterUserId,
        action: "ethics_report.create",
        entityType: "EthicsReport",
        entityId: report.id,
        after: {
          protocol: report.protocol,
          category: report.category,
          isAnonymous: report.isAnonymous,
        },
      });

      res.status(201).json({
        report: publicReportView(report),
        access_code: accessCode,
        message:
          "Guarde o protocolo e o código de acesso — o código não será mostrado de novo.",
      });
    } catch (err) {
      fail(res, err);
    }
  }

  /** Acompanhamento público por protocolo + código (ADR-16). */
  async track(req: Request, res: Response) {
    try {
      const { protocol, access_code, organization_id } = req.body as {
        protocol?: string;
        access_code?: string;
        organization_id?: string;
      };
      if (!protocol?.trim() || !access_code?.trim()) {
        res.status(400).json({
          message: "Informe protocol e access_code.",
        });
        return;
      }

      const report = await findByProtocolAndCode(
        organization_id,
        protocol,
        access_code,
      );
      if (!report) {
        res.status(404).json({ message: "Protocolo ou código inválido." });
        return;
      }

      await prisma.ethicsReportMessage.updateMany({
        where: {
          reportId: report.id,
          side: REPORT_AUTHOR_SIDES.COMMITTEE,
          readByReporterAt: null,
        },
        data: { readByReporterAt: new Date() },
      });

      res.json({ report: publicReportView(report) });
    } catch (err) {
      fail(res, err);
    }
  }

  /** Mensagem do denunciante (sem gravar authorUserId). */
  async addReporterMessage(req: Request, res: Response) {
    try {
      const { protocol, access_code, organization_id, body } = req.body as {
        protocol?: string;
        access_code?: string;
        organization_id?: string;
        body?: string;
      };
      if (!protocol?.trim() || !access_code?.trim() || !body?.trim()) {
        res.status(400).json({
          message: "Informe protocol, access_code e body.",
        });
        return;
      }

      const report = await findByProtocolAndCode(
        organization_id,
        protocol,
        access_code,
      );
      if (!report) {
        res.status(404).json({ message: "Protocolo ou código inválido." });
        return;
      }
      if (
        report.status === REPORT_STATUSES.RESOLVED ||
        report.status === REPORT_STATUSES.ARCHIVED
      ) {
        res.status(409).json({
          message: "Relato encerrado — não recebe novas mensagens.",
        });
        return;
      }

      const message = await new EthicsReportMessage().create.new({
        reportId: report.id,
        side: REPORT_AUTHOR_SIDES.REPORTER,
        body: body.trim(),
        authorUserId: null,
      });

      if (report.status === REPORT_STATUSES.AWAITING_INFO) {
        await new EthicsReport().update.one(
          { id: report.id },
          { status: REPORT_STATUSES.IN_ANALYSIS },
        );
      }

      res.status(201).json({
        message: {
          id: message.id,
          side: message.side,
          body: message.body,
          createdAt: message.createdAt,
        },
      });
    } catch (err) {
      fail(res, err);
    }
  }

  // —— Comitê ——

  async list(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const status = req.query.status as string | undefined;
      const rows = await prisma.ethicsReport.findMany({
        where: {
          organizationId: orgId,
          ...(status && isReportStatus(status) ? { status } : {}),
        },
        orderBy: { createdAt: "desc" },
        include: {
          establishment: { select: { id: true, name: true } },
          _count: { select: { messages: true } },
        },
      });
      // Mensagens do denunciante que o comitê ainda não abriu. [S5-L]
      const unread = await prisma.ethicsReportMessage.groupBy({
        by: ["reportId"],
        where: {
          reportId: { in: rows.map((r) => r.id) },
          side: REPORT_AUTHOR_SIDES.REPORTER,
          readByCommitteeAt: null,
        },
        _count: { _all: true },
      });
      const unreadBy = new Map(unread.map((u) => [u.reportId, u._count._all]));
      // Nunca devolver accessCodeHash nem reporter em listagens anônimas.
      res.json({
        reports: rows.map((r) => ({
          id: r.id,
          protocol: r.protocol,
          category: r.category,
          description: r.description,
          isAnonymous: r.isAnonymous,
          reporterUserId: r.isAnonymous ? null : r.reporterUserId,
          status: r.status,
          establishmentId: r.establishmentId,
          establishment: r.establishment,
          linkedHazardId: r.linkedHazardId,
          resolutionNote: r.resolutionNote,
          resolvedAt: r.resolvedAt,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          _count: r._count,
          unread_from_reporter: unreadBy.get(r.id) ?? 0,
        })),
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async get(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const report = await prisma.ethicsReport.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: {
          establishment: { select: { id: true, name: true } },
          messages: {
            orderBy: { createdAt: "asc" },
            include: {
              author: { select: { id: true, name: true } },
            },
          },
        },
      });
      if (!report) {
        res.status(404).json({ message: "Relato não encontrado." });
        return;
      }

      await prisma.ethicsReportMessage.updateMany({
        where: {
          reportId: report.id,
          side: REPORT_AUTHOR_SIDES.REPORTER,
          readByCommitteeAt: null,
        },
        data: { readByCommitteeAt: new Date() },
      });

      const { accessCodeHash: _hash, ...safe } = report;
      res.json({
        report: {
          ...safe,
          reporterUserId: report.isAnonymous ? null : report.reporterUserId,
          reporter: undefined,
        },
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async updateStatus(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const current = await new EthicsReport().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!current) {
        res.status(404).json({ message: "Relato não encontrado." });
        return;
      }

      const {
        status,
        resolution_note,
        linked_hazard_id,
      } = req.body as {
        status?: string;
        resolution_note?: string;
        linked_hazard_id?: string | null;
      };

      if (!status || !isReportStatus(status)) {
        res.status(400).json({
          message: `status inválido. Use: ${REPORT_STATUS_VALUES.join(", ")}.`,
        });
        return;
      }

      if (
        (status === REPORT_STATUSES.RESOLVED ||
          status === REPORT_STATUSES.ARCHIVED) &&
        !blank(resolution_note) &&
        !current.resolutionNote
      ) {
        res.status(400).json({
          message: "Informe resolution_note ao encerrar o relato.",
        });
        return;
      }

      if (linked_hazard_id) {
        const hazard = await new Hazard().read.one({
          id: linked_hazard_id,
          organizationId: orgId,
          archivedAt: null,
        });
        if (!hazard) {
          res.status(400).json({ message: "Perigo vinculado inválido." });
          return;
        }
      }

      const report = await new EthicsReport().update.one(
        { id: current.id, organizationId: orgId },
        {
          status,
          ...(resolution_note !== undefined
            ? { resolutionNote: blank(resolution_note) }
            : {}),
          ...(linked_hazard_id !== undefined
            ? { linkedHazardId: linked_hazard_id || null }
            : {}),
          ...(status === REPORT_STATUSES.RESOLVED ||
          status === REPORT_STATUSES.ARCHIVED
            ? { resolvedAt: new Date() }
            : {}),
        },
      );

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "ethics_report.update_status",
        entityType: "EthicsReport",
        entityId: current.id,
        after: { status },
      });

      if (!report) {
        res.status(500).json({ message: "Falha ao atualizar relato." });
        return;
      }

      const { accessCodeHash: _h, ...safe } = report;
      res.json({ report: safe });
    } catch (err) {
      fail(res, err);
    }
  }

  async addCommitteeMessage(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const report = await new EthicsReport().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!report) {
        res.status(404).json({ message: "Relato não encontrado." });
        return;
      }
      if (
        report.status === REPORT_STATUSES.RESOLVED ||
        report.status === REPORT_STATUSES.ARCHIVED
      ) {
        res.status(409).json({
          message: "Relato encerrado — não recebe novas mensagens.",
        });
        return;
      }

      const { body } = req.body as { body?: string };
      if (!body?.trim()) {
        res.status(400).json({ message: "Informe body." });
        return;
      }

      const message = await new EthicsReportMessage().create.new({
        reportId: report.id,
        side: REPORT_AUTHOR_SIDES.COMMITTEE,
        body: body.trim(),
        authorUserId: userId,
      });

      if (report.status === REPORT_STATUSES.RECEIVED) {
        await new EthicsReport().update.one(
          { id: report.id, organizationId: orgId },
          { status: REPORT_STATUSES.IN_ANALYSIS },
        );
      }

      res.status(201).json({ message });
    } catch (err) {
      fail(res, err);
    }
  }

  /** Catálogo de categorias para a UI pública. */
  async listCategories(_req: Request, res: Response) {
    res.json({
      categories: REPORT_CATEGORY_VALUES.map((id) => ({ id })),
      statuses: REPORT_STATUS_VALUES.map((id) => ({ id })),
    });
  }
}

export default new EthicsController();
