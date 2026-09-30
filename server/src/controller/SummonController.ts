import { Request, Response } from "express";
import prisma from "../model/prisma";
import { Summon } from "../model/schema/Summon/Summon";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { canWriteModule } from "../helper/module-access";
import {
  SUMMON_ATTENDANCE_STATUSES,
  SUMMON_ATTENDANCE_STATUS_VALUES,
  isSummonAttendanceStatus,
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
  return Boolean(req.actor && canWriteModule(req.actor.permission, "convocacoes"));
}

class SummonController {
  async list(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);

      const rows = await prisma.summon.findMany({
        where: {
          organizationId: orgId,
          ...(!isRh(auth)
            ? { attendances: { some: { userId } } }
            : {}),
        },
        orderBy: { scheduledFor: "desc" },
        include: {
          createdBy: { select: { id: true, name: true } },
          _count: { select: { attendances: true } },
          attendances: {
            where: { userId },
            select: { status: true, confirmedAt: true },
          },
        },
      });
      res.json({
        summons: rows.map((s) => ({
          ...s,
          my_attendance: s.attendances[0] ?? null,
          attendances: undefined,
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
      const summon = await prisma.summon.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: {
          createdBy: { select: { id: true, name: true } },
          attendances: {
            include: { user: { select: { id: true, name: true } } },
          },
        },
      });
      if (!summon) {
        res.status(404).json({ message: "Convocação não encontrada." });
        return;
      }
      if (
        !isRh(auth) &&
        !summon.attendances.some((a) => a.userId === actorUserId(auth))
      ) {
        res.status(403).json({ message: "Sem permissão." });
        return;
      }
      res.json({ summon });
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
        description,
        scheduled_for,
        location,
        invitee_ids,
      } = req.body as {
        title?: string;
        description?: string;
        scheduled_for?: string;
        location?: string;
        invitee_ids?: string[];
      };

      if (!title?.trim() || !scheduled_for) {
        res.status(400).json({
          message: "Informe title e scheduled_for.",
        });
        return;
      }

      const invitees = Array.isArray(invitee_ids) ? invitee_ids : [];
      for (const id of invitees) {
        const m = await prisma.membership.findFirst({
          where: { userId: id, organizationId: orgId },
        });
        if (!m) {
          res.status(400).json({ message: `Convidado inválido: ${id}` });
          return;
        }
      }

      const summon = await prisma.$transaction(async (tx) => {
        const created = await tx.summon.create({
          data: {
            organizationId: orgId,
            title: title.trim(),
            description: blank(description),
            scheduledFor: new Date(scheduled_for),
            location: blank(location),
            createdById: userId,
          },
        });
        if (invitees.length) {
          await tx.summonAttendance.createMany({
            data: invitees.map((uid) => ({
              summonId: created.id,
              userId: uid,
              status: SUMMON_ATTENDANCE_STATUSES.INVITED,
            })),
          });
        }
        return created;
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "summon.create",
        entityType: "Summon",
        entityId: summon.id,
      });

      res.status(201).json({ summon });
    } catch (err) {
      fail(res, err);
    }
  }

  async invite(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const summon = await new Summon().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!summon) {
        res.status(404).json({ message: "Convocação não encontrada." });
        return;
      }
      const { user_ids } = req.body as { user_ids?: string[] };
      if (!Array.isArray(user_ids) || user_ids.length === 0) {
        res.status(400).json({ message: "Informe user_ids." });
        return;
      }

      const created = [];
      for (const uid of user_ids) {
        const m = await prisma.membership.findFirst({
          where: { userId: uid, organizationId: orgId },
        });
        if (!m) continue;
        const row = await prisma.summonAttendance.upsert({
          where: {
            summonId_userId: { summonId: summon.id, userId: uid },
          },
          create: {
            summonId: summon.id,
            userId: uid,
            status: SUMMON_ATTENDANCE_STATUSES.INVITED,
          },
          update: {},
        });
        created.push(row);
      }
      res.status(201).json({ attendances: created });
    } catch (err) {
      fail(res, err);
    }
  }

  async updateAttendance(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const actorId = actorUserId(auth);
      const summon = await new Summon().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!summon) {
        res.status(404).json({ message: "Convocação não encontrada." });
        return;
      }

      const { status, user_id } = req.body as {
        status?: string;
        user_id?: string;
      };
      if (!status || !isSummonAttendanceStatus(status)) {
        res.status(400).json({
          message: `status inválido. Use: ${SUMMON_ATTENDANCE_STATUS_VALUES.join(", ")}.`,
        });
        return;
      }

      const targetUserId = isRh(auth) && user_id ? user_id : actorId;
      if (!isRh(auth) && targetUserId !== actorId) {
        res.status(403).json({ message: "Sem permissão." });
        return;
      }
      // Colaborador só confirma; RH marca presença/falta.
      if (
        !isRh(auth) &&
        status !== SUMMON_ATTENDANCE_STATUSES.CONFIRMED
      ) {
        res.status(403).json({
          message: "Colaborador só pode confirmar (CONFIRMED).",
        });
        return;
      }

      const attendance = await prisma.summonAttendance.upsert({
        where: {
          summonId_userId: {
            summonId: summon.id,
            userId: targetUserId,
          },
        },
        create: {
          summonId: summon.id,
          userId: targetUserId,
          status,
          confirmedAt:
            status === SUMMON_ATTENDANCE_STATUSES.CONFIRMED
              ? new Date()
              : null,
        },
        update: {
          status,
          ...(status === SUMMON_ATTENDANCE_STATUSES.CONFIRMED
            ? { confirmedAt: new Date() }
            : {}),
        },
      });

      res.json({ attendance });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new SummonController();
