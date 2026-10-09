import {
  ActionStatus,
  ControlStatus,
  EvidenceType,
  EvidenceValidationStatus,
} from "@prisma/client";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { Action } from "../model/schema/Action/Action";
import { Evidence } from "../model/schema/Evidence/Evidence";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import {
  assertSize,
  buildEvidenceStoragePath,
  writeEvidenceFile,
} from "../helper/uploads";
import { sendPrivateFile } from "../helper/send-private-file";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

/** Quem “executou” a ação: assignee se houver, senão quem criou. */
function executorId(action: { assigneeId: string | null; createdById: string }) {
  return action.assigneeId || action.createdById;
}

class ActionEvidenceController {
  async listEvidences(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const actionId = req.query.action_id as string | undefined;
      const rows = await prisma.evidence.findMany({
        where: { organizationId: orgId, ...(actionId ? { actionId } : {}) },
        orderBy: { uploadedAt: "desc" },
        // storagePath é interno e nunca sai do servidor; o arquivo vem por
        // GET /api/evidences/:id/file.
        select: {
          id: true,
          type: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          description: true,
          eventDate: true,
          uploadedAt: true,
          validationStatus: true,
          reviewedAt: true,
          actionId: true,
          uploadedBy: { select: { id: true, name: true } },
          reviewedBy: { select: { id: true, name: true } },
        },
      });
      res.json({ evidences: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Conteúdo da evidência de uma ação, para quem vai validar VER a prova
   * antes de decidir. [S3-L]
   *
   * Serve inline (a foto aparece na tela) com o tipo gravado no envio, que só
   * aceita jpg/png/webp/pdf/mp4. Só evidência de AÇÃO: as de ocorrência,
   * AEP, simulado e participação seguem a permissão do módulo delas.
   */
  async evidenceFile(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const evidence = await prisma.evidence.findFirst({
        where: {
          id: req.params.id,
          organizationId: orgId,
          actionId: { not: null },
        },
        select: { storagePath: true, fileName: true, mimeType: true, sizeBytes: true },
      });
      if (!evidence) {
        res.status(404).json({ message: "Evidência não encontrada." });
        return;
      }
      sendPrivateFile(res, evidence, "Esta evidência foi registrada sem arquivo.");
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Registra evidência. Conteúdo opcional em content_base64;
   * senão grava stub vazio no storage privado (BR-15 mime/size).
   */
  async createEvidence(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const {
        action_id,
        type,
        file_name,
        mime_type,
        description,
        event_date,
        content_base64,
      } = req.body as {
        action_id?: string;
        type?: EvidenceType;
        file_name?: string;
        mime_type?: string;
        description?: string;
        event_date?: string;
        content_base64?: string;
      };

      if (!action_id || !file_name?.trim() || !mime_type) {
        res.status(400).json({
          message: "Informe action_id, file_name e mime_type.",
        });
        return;
      }

      const action = await new Action().read.one({
        id: action_id,
        organizationId: orgId,
      });
      if (!action) {
        res.status(400).json({ message: "Ação inválida." });
        return;
      }
      if (
        action.status === ActionStatus.VALIDATED ||
        action.status === ActionStatus.CLOSED ||
        action.status === ActionStatus.CANCELLED
      ) {
        res.status(409).json({ message: "Ação encerrada não aceita evidência." });
        return;
      }

      const data = content_base64
        ? Buffer.from(content_base64, "base64")
        : Buffer.alloc(0);
      assertSize(data.length || 0);

      const { storagePath, absolutePath } = buildEvidenceStoragePath(
        orgId,
        mime_type,
      );
      writeEvidenceFile(absolutePath, data);

      const row = await new Evidence().create.new({
        organizationId: orgId,
        type: type ?? EvidenceType.DOCUMENT,
        storagePath,
        fileName: file_name.trim(),
        mimeType: mime_type,
        sizeBytes: data.length,
        description: description ?? null,
        eventDate: event_date ? new Date(event_date) : null,
        uploadedById: userId,
        actionId: action_id,
        validationStatus: EvidenceValidationStatus.PENDING,
      });

      if (action.status === ActionStatus.OPEN) {
        await new Action().update.one(
          { id: action_id, organizationId: orgId },
          { status: ActionStatus.IN_PROGRESS },
        );
      }

      const { storagePath: _interno, ...evidence } = row;
      res.status(201).json({ evidence });
    } catch (err) {
      fail(res, err);
    }
  }

  /** BR-6: concluir exige ≥1 evidência → WAITING_VALIDATION */
  async completeAction(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const id = req.params.id;
      const action = await new Action().read.one({ id, organizationId: orgId });
      if (!action) {
        res.status(404).json({ message: "Ação não encontrada." });
        return;
      }
      if (
        action.status !== ActionStatus.OPEN &&
        action.status !== ActionStatus.IN_PROGRESS
      ) {
        res.status(409).json({ message: "Ação não pode ser concluída neste status." });
        return;
      }

      const count = await prisma.evidence.count({
        where: { actionId: id, organizationId: orgId },
      });
      if (count < 1) {
        res.status(400).json({
          message: "Envie ao menos uma evidência antes de concluir.",
        });
        return;
      }

      const row = await new Action().update.one(
        { id, organizationId: orgId },
        {
          status: ActionStatus.WAITING_VALIDATION,
          completedAt: new Date(),
        },
      );
      res.json({ action: row });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * BR-7/8/9/10: aprovar ou rejeitar.
   * Quem executou não valida. Approve aceita evidências e implementa controle.
   */
  async reviewAction(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const id = req.params.id;
      const {
        decision,
        effectiveness_result,
        rejection_reason,
        flag_reassessment,
        reassessment_reason,
      } = req.body as {
        decision?: "approve" | "reject";
        effectiveness_result?: string;
        rejection_reason?: string;
        flag_reassessment?: boolean;
        reassessment_reason?: string;
      };

      if (decision !== "approve" && decision !== "reject") {
        res.status(400).json({ message: "Informe decision: approve | reject." });
        return;
      }

      const result = await prisma.$transaction(async (tx) => {
        const action = await tx.action.findFirst({
          where: { id, organizationId: orgId },
        });
        if (!action) {
          throw Object.assign(new Error("Ação não encontrada."), { status: 404 });
        }
        if (action.status !== ActionStatus.WAITING_VALIDATION) {
          throw Object.assign(
            new Error("Ação não está aguardando validação."),
            { status: 409 },
          );
        }
        if (executorId(action) === userId) {
          throw Object.assign(
            new Error("Quem executou a ação não pode validá-la."),
            { status: 403 },
          );
        }

        if (decision === "reject") {
          if (!rejection_reason?.trim()) {
            throw Object.assign(new Error("Informe rejection_reason."), {
              status: 400,
            });
          }
          await tx.evidence.updateMany({
            where: {
              actionId: id,
              organizationId: orgId,
              validationStatus: EvidenceValidationStatus.PENDING,
            },
            data: {
              validationStatus: EvidenceValidationStatus.REJECTED,
              reviewedById: userId,
              reviewedAt: new Date(),
            },
          });
          return tx.action.update({
            where: { id },
            data: {
              status: ActionStatus.IN_PROGRESS,
              rejectionReason: rejection_reason.trim(),
              validatedById: null,
              validatedAt: null,
              completedAt: null,
            },
          });
        }

        // approve
        await tx.evidence.updateMany({
          where: {
            actionId: id,
            organizationId: orgId,
            validationStatus: EvidenceValidationStatus.PENDING,
          },
          data: {
            validationStatus: EvidenceValidationStatus.ACCEPTED,
            reviewedById: userId,
            reviewedAt: new Date(),
          },
        });

        if (action.controlId) {
          await tx.controlMeasure.update({
            where: { id: action.controlId },
            data: {
              status: ControlStatus.IMPLEMENTED,
              implementedAt: new Date(),
            },
          });
        }

        if (flag_reassessment && action.riskId) {
          await tx.risk.update({
            where: { id: action.riskId },
            data: {
              needsReassessment: true,
              reassessmentReason:
                reassessment_reason?.trim() ||
                "Controle implementado — reavaliar risco residual",
            },
          });
        }

        return tx.action.update({
          where: { id },
          data: {
            status: ActionStatus.VALIDATED,
            validatedById: userId,
            validatedAt: new Date(),
            effectivenessResult: effectiveness_result ?? null,
            rejectionReason: null,
          },
        });
      });

      res.json({ action: result });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new ActionEvidenceController();
