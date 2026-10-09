import { Request, Response } from "express";
import prisma from "../model/prisma";
import { MedicalCertificate } from "../model/schema/MedicalCertificate/MedicalCertificate";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { canManageModule } from "../helper/module-access";
import {
  assertSize,
  buildPrivateStoragePath,
  writeEvidenceFile,
} from "../helper/uploads";
import { sendPrivateFile } from "../helper/send-private-file";
import {
  CERTIFICATE_STATUSES,
  CERTIFICATE_STATUS_VALUES,
  isCertificateStatus,
} from "../constants";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function blank(v?: string | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

/**
 * Quem cuida do atestado DOS OUTROS. Não é "quem pode escrever": o colaborador
 * escreve para enviar o próprio atestado, e isso não o torna RH. [S4-A] [S4-J]
 */
function isRh(req: AuthRequest): boolean {
  return Boolean(req.actor && canManageModule(req.actor.permission, "atestados"));
}

/** O caminho no disco é interno; o arquivo sai por GET /:id/file. [S5-B] */
function publicCertificate<T extends { storagePath: string | null }>(certificate: T | null) {
  if (!certificate) return certificate;
  const { storagePath, ...rest } = certificate;
  return { ...rest, has_file: Boolean(storagePath) };
}

class MedicalCertificateController {
  async list(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const status = req.query.status as string | undefined;

      const rows = await prisma.medicalCertificate.findMany({
        where: {
          organizationId: orgId,
          ...(!isRh(auth) ? { userId } : {}),
          ...(status && isCertificateStatus(status) ? { status } : {}),
        },
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, name: true } },
          reviewedBy: { select: { id: true, name: true } },
        },
      });
      // O caminho no disco é interno; o arquivo sai por /:id/file. [S5-B]
      res.json({ certificates: rows.map(publicCertificate) });
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
        start_date,
        days,
        cid,
        reason,
        file_name,
        mime_type,
        content_base64,
      } = req.body as {
        start_date?: string;
        days?: number;
        cid?: string;
        reason?: string;
        file_name?: string;
        mime_type?: string;
        content_base64?: string;
      };

      if (!start_date || !days || days < 1) {
        res.status(400).json({
          message: "Informe start_date e days (≥ 1).",
        });
        return;
      }

      let storagePath: string | null = null;
      let fileName: string | null = null;
      if (file_name && mime_type) {
        const data = content_base64
          ? Buffer.from(content_base64, "base64")
          : Buffer.alloc(0);
        assertSize(data.length || 0);
        const built = buildPrivateStoragePath(orgId, "certificates", mime_type);
        writeEvidenceFile(built.absolutePath, data);
        storagePath = built.storagePath;
        fileName = file_name.trim();
      }

      const certificate = await new MedicalCertificate().create.new({
        organizationId: orgId,
        userId,
        startDate: new Date(start_date),
        days,
        cid: blank(cid),
        reason: blank(reason),
        storagePath,
        fileName,
        status: CERTIFICATE_STATUSES.PENDING,
      });

      res.status(201).json({ certificate: publicCertificate(certificate) });
    } catch (err) {
      fail(res, err);
    }
  }

  async review(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const reviewerId = actorUserId(auth);
      const current = await new MedicalCertificate().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!current) {
        res.status(404).json({ message: "Atestado não encontrado." });
        return;
      }
      if (current.status !== CERTIFICATE_STATUSES.PENDING) {
        res.status(409).json({ message: "Atestado já revisado." });
        return;
      }
      /*
        Separação de funções: quem enviou não decide sobre o próprio atestado,
        mesmo sendo do RH. Abonar a própria falta tira do documento o valor de
        controle — para a folha e para a fiscalização. [S4-J]
      */
      if (current.userId === reviewerId) {
        res.status(403).json({
          message: "O próprio atestado é decidido por outra pessoa do RH.",
        });
        return;
      }

      const { status, rejection_reason } = req.body as {
        status?: string;
        rejection_reason?: string;
      };
      if (
        status !== CERTIFICATE_STATUSES.APPROVED &&
        status !== CERTIFICATE_STATUSES.REJECTED
      ) {
        res.status(400).json({
          message: `status deve ser APPROVED ou REJECTED (${CERTIFICATE_STATUS_VALUES.join(", ")}).`,
        });
        return;
      }
      if (status === CERTIFICATE_STATUSES.REJECTED && !blank(rejection_reason)) {
        res.status(400).json({
          message: "Informe rejection_reason ao rejeitar.",
        });
        return;
      }

      const certificate = await new MedicalCertificate().update.one(
        { id: current.id, organizationId: orgId },
        {
          status,
          rejectionReason:
            status === CERTIFICATE_STATUSES.REJECTED
              ? blank(rejection_reason)
              : null,
          reviewedById: reviewerId,
          reviewedAt: new Date(),
        },
      );

      await writeAudit({
        organizationId: orgId,
        actorId: reviewerId,
        action: "medical_certificate.review",
        entityType: "MedicalCertificate",
        entityId: current.id,
        after: { status },
      });

      res.json({ certificate: publicCertificate(certificate) });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Arquivo do atestado, para o RH abrir antes de decidir [S5-B] e para quem
   * enviou rever o que mandou. Mais ninguém: é dado de saúde.
   */
  async file(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const certificate = await prisma.medicalCertificate.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        select: { userId: true, storagePath: true, fileName: true },
      });
      // Quem não pode ver recebe o mesmo 404 de quem não existe.
      if (!certificate || (!isRh(auth) && certificate.userId !== actorUserId(auth))) {
        res.status(404).json({ message: "Atestado não encontrado." });
        return;
      }
      sendPrivateFile(res, certificate, "Este atestado foi enviado sem arquivo.");
    } catch (err) {
      fail(res, err);
    }
  }

  /** Trabalhador marca recusa/resultado como lido. */
  async markRead(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const current = await new MedicalCertificate().read.one({
        id: req.params.id,
        organizationId: orgId,
        userId,
      });
      if (!current) {
        res.status(404).json({ message: "Atestado não encontrado." });
        return;
      }
      const certificate = await new MedicalCertificate().update.one(
        { id: current.id },
        { readByWorkerAt: new Date() },
      );
      res.json({ certificate: publicCertificate(certificate) });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new MedicalCertificateController();
