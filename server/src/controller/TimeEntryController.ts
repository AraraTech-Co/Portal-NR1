import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../model/prisma";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { canManageModule } from "../helper/module-access";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    res.status(409).json({ message: "Já existe apontamento neste dia." });
    return;
  }
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function blank(v?: string | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

function isRh(req: AuthRequest) {
  return Boolean(req.actor && canManageModule(req.actor.permission, "ponto"));
}

function dayOnly(iso: string): Date {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

class TimeEntryController {
  async list(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const rows = await prisma.timeEntry.findMany({
        where: {
          organizationId: orgId,
          ...(!isRh(auth) ? { userId } : {}),
          ...(req.query.user_id && isRh(auth)
            ? { userId: String(req.query.user_id) }
            : {}),
        },
        orderBy: { day: "desc" },
        take: 90,
      });
      res.json({ entries: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async upsert(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const actorId = actorUserId(auth);
      const {
        user_id,
        day,
        in1,
        out1,
        in2,
        out2,
        balance_minutes,
        note,
      } = req.body as Record<string, unknown>;

      if (!day) {
        res.status(400).json({ message: "Informe day." });
        return;
      }
      const targetUserId =
        isRh(auth) && user_id ? String(user_id) : actorId;
      const dayDate = dayOnly(String(day));

      const entry = await prisma.timeEntry.upsert({
        where: {
          organizationId_userId_day: {
            organizationId: orgId,
            userId: targetUserId,
            day: dayDate,
          },
        },
        create: {
          organizationId: orgId,
          userId: targetUserId,
          day: dayDate,
          in1: blank(in1 as string),
          out1: blank(out1 as string),
          in2: blank(in2 as string),
          out2: blank(out2 as string),
          balanceMinutes: (balance_minutes as number) ?? 0,
          note: blank(note as string),
        },
        update: {
          ...(in1 !== undefined ? { in1: blank(in1 as string) } : {}),
          ...(out1 !== undefined ? { out1: blank(out1 as string) } : {}),
          ...(in2 !== undefined ? { in2: blank(in2 as string) } : {}),
          ...(out2 !== undefined ? { out2: blank(out2 as string) } : {}),
          ...(balance_minutes !== undefined
            ? { balanceMinutes: balance_minutes as number }
            : {}),
          ...(note !== undefined ? { note: blank(note as string) } : {}),
        },
      });
      res.status(201).json({ entry });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new TimeEntryController();
