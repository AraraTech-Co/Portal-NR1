import { Request, Response } from "express";
import prisma from "../model/prisma";
import { HrDocument } from "../model/schema/HrDocument/HrDocument";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { canManageModule } from "../helper/module-access";
import {
  assertSize,
  buildPrivateStoragePath,
  writeEvidenceFile,
} from "../helper/uploads";
import {
  HR_DOCUMENT_KIND_DEFAULT,
  HR_DOCUMENT_KIND_VALUES,
  isHrDocumentKind,
} from "../constants";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function blank(v?: string | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

function isRh(req: AuthRequest): boolean {
  return Boolean(req.actor && canManageModule(req.actor.permission, "documentos_rh"));
}

class HrDocumentController {
  async list(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const kind = req.query.kind as string | undefined;

      const rows = await prisma.hrDocument.findMany({
        where: {
          organizationId: orgId,
          ...(kind && isHrDocumentKind(kind) ? { kind } : {}),
          ...(!isRh(auth)
            ? {
                OR: [{ targetUserId: null }, { targetUserId: userId }],
              }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        include: {
          publishedBy: { select: { id: true, name: true } },
          target: { select: { id: true, name: true } },
          acks: {
            where: { userId },
            select: { readAt: true, acknowledgedAt: true },
          },
          _count: { select: { acks: true } },
        },
      });

      res.json({
        documents: rows.map((d) => ({
          ...d,
          my_ack: d.acks[0] ?? null,
          acks: undefined,
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
      const doc = await prisma.hrDocument.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: {
          publishedBy: { select: { id: true, name: true } },
          target: { select: { id: true, name: true } },
          acks: isRh(auth)
            ? {
                include: {
                  user: { select: { id: true, name: true } },
                },
              }
            : { where: { userId } },
        },
      });
      if (!doc) {
        res.status(404).json({ message: "Documento não encontrado." });
        return;
      }
      if (
        !isRh(auth) &&
        doc.targetUserId &&
        doc.targetUserId !== userId
      ) {
        res.status(403).json({ message: "Sem permissão." });
        return;
      }

      // Marca leitura ao abrir.
      await prisma.hrDocumentAck.upsert({
        where: {
          documentId_userId: { documentId: doc.id, userId },
        },
        create: { documentId: doc.id, userId },
        update: {},
      });

      res.json({ document: doc });
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
        kind,
        title,
        description,
        requires_ack,
        target_user_id,
        file_name,
        mime_type,
        content_base64,
      } = req.body as {
        kind?: string;
        title?: string;
        description?: string;
        requires_ack?: boolean;
        target_user_id?: string;
        file_name?: string;
        mime_type?: string;
        content_base64?: string;
      };

      if (!title?.trim() || !file_name?.trim() || !mime_type) {
        res.status(400).json({
          message: "Informe title, file_name e mime_type.",
        });
        return;
      }

      const resolvedKind = kind
        ? isHrDocumentKind(kind)
          ? kind
          : null
        : HR_DOCUMENT_KIND_DEFAULT;
      if (!resolvedKind) {
        res.status(400).json({
          message: `kind inválido. Use: ${HR_DOCUMENT_KIND_VALUES.join(", ")}.`,
        });
        return;
      }

      if (target_user_id) {
        const m = await prisma.membership.findFirst({
          where: { userId: target_user_id, organizationId: orgId },
        });
        if (!m) {
          res.status(400).json({ message: "Destinatário inválido." });
          return;
        }
      }

      const data = content_base64
        ? Buffer.from(content_base64, "base64")
        : Buffer.alloc(0);
      assertSize(data.length || 0);
      const { storagePath, absolutePath } = buildPrivateStoragePath(
        orgId,
        "hr-documents",
        mime_type,
      );
      writeEvidenceFile(absolutePath, data);

      const document = await new HrDocument().create.new({
        organizationId: orgId,
        kind: resolvedKind,
        title: title.trim(),
        description: blank(description),
        storagePath,
        fileName: file_name.trim(),
        mimeType: mime_type,
        sizeBytes: data.length,
        requiresAck: Boolean(requires_ack),
        targetUserId: target_user_id ?? null,
        publishedById: userId,
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "hr_document.create",
        entityType: "HrDocument",
        entityId: document.id,
      });

      res.status(201).json({ document });
    } catch (err) {
      fail(res, err);
    }
  }

  /** Ciência formal quando requiresAck. */
  async acknowledge(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const doc = await new HrDocument().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!doc) {
        res.status(404).json({ message: "Documento não encontrado." });
        return;
      }
      if (doc.targetUserId && doc.targetUserId !== userId) {
        res.status(403).json({ message: "Documento não é para você." });
        return;
      }
      if (!doc.requiresAck) {
        res.status(400).json({
          message: "Este documento não exige ciência formal.",
        });
        return;
      }

      const ack = await prisma.hrDocumentAck.upsert({
        where: {
          documentId_userId: { documentId: doc.id, userId },
        },
        create: {
          documentId: doc.id,
          userId,
          acknowledgedAt: new Date(),
        },
        update: { acknowledgedAt: new Date() },
      });

      res.json({ ack });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new HrDocumentController();
