import { Request, Response } from "express";
import prisma from "../model/prisma";
import { LeaveRequest } from "../model/schema/LeaveRequest/LeaveRequest";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { canWriteModule } from "../helper/module-access";
import {
  LEAVE_KIND_DEFAULT,
  LEAVE_KIND_VALUES,
  LEAVE_STATUSES,
  LEAVE_STATUS_VALUES,
  isLeaveKind,
  isLeaveStatus,
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
  return Boolean(req.actor && canWriteModule(req.actor.permission, "ferias"));
}

function daysBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
}

class LeaveController {
  async list(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const status = req.query.status as string | undefined;

      const rows = await prisma.leaveRequest.findMany({
        where: {
          organizationId: orgId,
          ...(!isRh(auth) ? { userId } : {}),
          ...(status && isLeaveStatus(status) ? { status } : {}),
        },
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, name: true } },
          decidedBy: { select: { id: true, name: true } },
        },
      });
      res.json({ leaves: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async create(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const { kind, start_date, end_date, note } = req.body as {
        kind?: string;
        start_date?: string;
        end_date?: string;
        note?: string;
      };

      if (!start_date || !end_date) {
        res.status(400).json({ message: "Informe start_date e end_date." });
        return;
      }
      const resolvedKind = kind
        ? isLeaveKind(kind)
          ? kind
          : null
        : LEAVE_KIND_DEFAULT;
      if (!resolvedKind) {
        res.status(400).json({
          message: `kind inválido. Use: ${LEAVE_KIND_VALUES.join(", ")}.`,
        });
        return;
      }

      const startDate = new Date(start_date);
      const endDate = new Date(end_date);
      if (endDate < startDate) {
        res.status(400).json({
          message: "end_date deve ser ≥ start_date.",
        });
        return;
      }

      const leave = await new LeaveRequest().create.new({
        organizationId: orgId,
        userId,
        kind: resolvedKind,
        startDate,
        endDate,
        days: daysBetween(startDate, endDate),
        note: blank(note),
        status: LEAVE_STATUSES.REQUESTED,
      });

      res.status(201).json({ leave });
    } catch (err) {
      fail(res, err);
    }
  }

  async decide(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const deciderId = actorUserId(auth);
      const current = await new LeaveRequest().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!current) {
        res.status(404).json({ message: "Solicitação não encontrada." });
        return;
      }
      if (current.status !== LEAVE_STATUSES.REQUESTED) {
        res.status(409).json({ message: "Solicitação já decidida." });
        return;
      }

      const { status, decision_note } = req.body as {
        status?: string;
        decision_note?: string;
      };
      if (
        status !== LEAVE_STATUSES.APPROVED &&
        status !== LEAVE_STATUSES.REJECTED
      ) {
        res.status(400).json({
          message: `status deve ser APPROVED ou REJECTED (${LEAVE_STATUS_VALUES.join(", ")}).`,
        });
        return;
      }
      if (status === LEAVE_STATUSES.REJECTED && !blank(decision_note)) {
        res.status(400).json({
          message: "Informe decision_note ao rejeitar.",
        });
        return;
      }

      const leave = await new LeaveRequest().update.one(
        { id: current.id, organizationId: orgId },
        {
          status,
          decisionNote: blank(decision_note),
          decidedById: deciderId,
          decidedAt: new Date(),
        },
      );

      await writeAudit({
        organizationId: orgId,
        actorId: deciderId,
        action: "leave.decide",
        entityType: "LeaveRequest",
        entityId: current.id,
        after: { status },
      });

      res.json({ leave });
    } catch (err) {
      fail(res, err);
    }
  }

  async cancel(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const current = await new LeaveRequest().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!current) {
        res.status(404).json({ message: "Solicitação não encontrada." });
        return;
      }
      if (current.userId !== userId && !isRh(auth)) {
        res.status(403).json({ message: "Sem permissão." });
        return;
      }
      if (current.status !== LEAVE_STATUSES.REQUESTED) {
        res.status(409).json({
          message: "Só pedidos REQUESTED podem ser cancelados.",
        });
        return;
      }
      const leave = await new LeaveRequest().update.one(
        { id: current.id, organizationId: orgId },
        { status: LEAVE_STATUSES.CANCELLED },
      );
      res.json({ leave });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new LeaveController();
