import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

/** A caixa de avisos da pessoa. Cada um vê só a sua. [S3-A] [S3-G] [S4-G] */
class NotificationController {
  async list(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const rows = await prisma.notification.findMany({
        where: { userId: actorUserId(auth), organizationId: actorOrgId(auth) },
        orderBy: [{ readAt: "asc" }, { createdAt: "desc" }],
        take: 50,
        select: {
          id: true,
          kind: true,
          title: true,
          body: true,
          link: true,
          readAt: true,
          createdAt: true,
        },
      });
      res.json({
        notifications: rows,
        unread: rows.filter((n) => !n.readAt).length,
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async markRead(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const updated = await prisma.notification.updateMany({
        where: {
          id: req.params.id,
          userId: actorUserId(auth),
          organizationId: actorOrgId(auth),
        },
        data: { readAt: new Date() },
      });
      if (updated.count === 0) {
        res.status(404).json({ message: "Aviso não encontrado." });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  }

  async markAllRead(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const updated = await prisma.notification.updateMany({
        where: {
          userId: actorUserId(auth),
          organizationId: actorOrgId(auth),
          readAt: null,
        },
        data: { readAt: new Date() },
      });
      res.json({ ok: true, count: updated.count });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new NotificationController();
