import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { canWriteModule } from "../helper/module-access";
import {
  assertSize,
  buildPrivateStoragePath,
  writeEvidenceFile,
} from "../helper/uploads";
import {
  CERTIFICATE_STATUSES,
  EXAM_KIND_DEFAULT,
  EXAM_KIND_VALUES,
  REQUIREMENT_KIND_VALUES,
  isCertificateStatus,
  isExamKind,
  isRequirementKind,
} from "../constants";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function blank(v?: string | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

function isRh(req: AuthRequest) {
  return Boolean(req.actor && canWriteModule(req.actor.permission, "saude"));
}

/** Exigências por função + certificados do trabalhador + exames (ASO). */
class ComplianceController {
  async listRequirements(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const jobRoleId = req.query.job_role_id as string | undefined;
      const rows = await prisma.jobRoleRequirement.findMany({
        where: {
          organizationId: orgId,
          ...(jobRoleId ? { jobRoleId } : {}),
        },
        orderBy: { createdAt: "desc" },
        include: {
          jobRole: { select: { id: true, name: true } },
          training: { select: { id: true, title: true } },
        },
      });
      res.json({ requirements: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async createRequirement(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const {
        job_role_id,
        kind,
        name,
        description,
        training_id,
        validity_months,
      } = req.body as Record<string, unknown>;

      if (!job_role_id || !name || typeof name !== "string") {
        res.status(400).json({ message: "Informe job_role_id e name." });
        return;
      }
      const resolvedKind =
        kind && isRequirementKind(String(kind))
          ? String(kind)
          : "CERTIFICATE";
      if (kind && !isRequirementKind(String(kind))) {
        res.status(400).json({
          message: `kind inválido. Use: ${REQUIREMENT_KIND_VALUES.join(", ")}.`,
        });
        return;
      }

      const role = await prisma.jobRole.findFirst({
        where: {
          id: String(job_role_id),
          organizationId: orgId,
          archivedAt: null,
        },
      });
      if (!role) {
        res.status(400).json({ message: "Função inválida." });
        return;
      }

      const row = await prisma.jobRoleRequirement.create({
        data: {
          organizationId: orgId,
          jobRoleId: String(job_role_id),
          kind: resolvedKind as never,
          name: name.trim(),
          description: blank(description as string),
          trainingId: (training_id as string) || null,
          validityMonths: (validity_months as number) ?? null,
        },
      });
      res.status(201).json({ requirement: row });
    } catch (err) {
      fail(res, err);
    }
  }

  async listCertificates(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const rows = await prisma.workerCertificate.findMany({
        where: {
          organizationId: orgId,
          ...(!isRh(auth) ? { userId } : {}),
          ...(req.query.user_id && isRh(auth)
            ? { userId: String(req.query.user_id) }
            : {}),
        },
        orderBy: { createdAt: "desc" },
      });
      res.json({ certificates: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async createCertificate(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const actorId = actorUserId(auth);
      const body = req.body as Record<string, unknown>;
      const targetUserId = isRh(auth) && body.user_id
        ? String(body.user_id)
        : actorId;
      if (!body.name || typeof body.name !== "string") {
        res.status(400).json({ message: "Informe name." });
        return;
      }

      let storagePath: string | null = null;
      let fileName: string | null = null;
      if (body.file_name && body.mime_type) {
        const data = body.content_base64
          ? Buffer.from(String(body.content_base64), "base64")
          : Buffer.alloc(0);
        assertSize(data.length || 0);
        const built = buildPrivateStoragePath(
          orgId,
          "worker-certs",
          String(body.mime_type),
        );
        writeEvidenceFile(built.absolutePath, data);
        storagePath = built.storagePath;
        fileName = String(body.file_name).trim();
      }

      const certificate = await prisma.workerCertificate.create({
        data: {
          organizationId: orgId,
          userId: targetUserId,
          requirementId: (body.requirement_id as string) || null,
          name: String(body.name).trim(),
          storagePath,
          fileName,
          issuedAt: body.issued_at
            ? new Date(String(body.issued_at))
            : null,
          expiresAt: body.expires_at
            ? new Date(String(body.expires_at))
            : null,
          status: CERTIFICATE_STATUSES.PENDING,
        },
      });
      res.status(201).json({ certificate });
    } catch (err) {
      fail(res, err);
    }
  }

  async reviewCertificate(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const reviewerId = actorUserId(auth);
      const current = await prisma.workerCertificate.findFirst({
        where: { id: req.params.id, organizationId: orgId },
      });
      if (!current) {
        res.status(404).json({ message: "Certificado não encontrado." });
        return;
      }
      const { status } = req.body as { status?: string };
      if (
        status !== CERTIFICATE_STATUSES.APPROVED &&
        status !== CERTIFICATE_STATUSES.REJECTED
      ) {
        res.status(400).json({ message: "status: APPROVED ou REJECTED." });
        return;
      }
      const certificate = await prisma.workerCertificate.update({
        where: { id: current.id },
        data: {
          status,
          reviewedById: reviewerId,
          reviewedAt: new Date(),
        },
      });
      res.json({ certificate });
    } catch (err) {
      fail(res, err);
    }
  }

  async listExams(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const rows = await prisma.occupationalExam.findMany({
        where: {
          organizationId: orgId,
          ...(!isRh(auth) ? { userId } : {}),
        },
        orderBy: { createdAt: "desc" },
      });
      res.json({ exams: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async createExam(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const {
        user_id,
        kind,
        performed_at,
        due_at,
        fit,
        file_name,
        mime_type,
        content_base64,
      } = req.body as Record<string, unknown>;

      if (!user_id) {
        res.status(400).json({ message: "Informe user_id." });
        return;
      }
      const resolvedKind =
        kind && isExamKind(String(kind)) ? String(kind) : EXAM_KIND_DEFAULT;
      if (kind && !isExamKind(String(kind))) {
        res.status(400).json({
          message: `kind inválido. Use: ${EXAM_KIND_VALUES.join(", ")}.`,
        });
        return;
      }

      let storagePath: string | null = null;
      let fileName: string | null = null;
      if (file_name && mime_type) {
        const data = content_base64
          ? Buffer.from(String(content_base64), "base64")
          : Buffer.alloc(0);
        assertSize(data.length || 0);
        const built = buildPrivateStoragePath(
          orgId,
          "exams",
          String(mime_type),
        );
        writeEvidenceFile(built.absolutePath, data);
        storagePath = built.storagePath;
        fileName = String(file_name).trim();
      }

      const exam = await prisma.occupationalExam.create({
        data: {
          organizationId: orgId,
          userId: String(user_id),
          kind: resolvedKind as never,
          performedAt: performed_at
            ? new Date(String(performed_at))
            : null,
          dueAt: due_at ? new Date(String(due_at)) : null,
          fit: typeof fit === "boolean" ? fit : null,
          storagePath,
          fileName,
        },
      });

      await writeAudit({
        organizationId: orgId,
        actorId: actorUserId(auth),
        action: "occupational_exam.create",
        entityType: "OccupationalExam",
        entityId: exam.id,
      });

      res.status(201).json({ exam });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new ComplianceController();
