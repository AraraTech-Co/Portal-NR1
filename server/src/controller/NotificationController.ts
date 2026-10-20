import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { canReadModule } from "../helper/module-access";
import { moduloDaRota } from "../helper/rota-do-modulo";
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
      const where = {
        userId: actorUserId(auth),
        organizationId: actorOrgId(auth),
      };
      /*
        Aviso que leva a uma tela que a pessoa não abre não é aviso: é um
        beco. Acontece com quem perdeu acesso a um módulo depois de já ter
        recebido o aviso — o fiscal e o mural, por exemplo. [B2-4-F]
      */
      const permitido = (link: string | null) => {
        const modulo = moduloDaRota(link);
        if (!modulo) return true;
        return canReadModule(auth.actor?.permission ?? "", modulo);
      };

      const [rows, naoLidos] = await Promise.all([
        prisma.notification.findMany({
          where,
          // Não lido primeiro. `asc` sozinho joga NULL para o fim no Postgres:
          // passando de 50 avisos, o não lido sumia da caixa.
          orderBy: [
            { readAt: { sort: "asc", nulls: "first" } },
            { createdAt: "desc" },
          ],
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
        }),
        // O contador é de tudo, não só do que coube na página.
        prisma.notification.findMany({
          where: { ...where, readAt: null },
          select: { link: true },
        }),
      ]);
      res.json({
        notifications: rows.filter((n) => permitido(n.link)),
        unread: naoLidos.filter((n) => permitido(n.link)).length,
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async markRead(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const userId = actorUserId(auth);
      const aviso = await prisma.notification.findFirst({
        where: {
          id: req.params.id,
          userId,
          organizationId: actorOrgId(auth),
        },
        select: { id: true, entityType: true, entityId: true },
      });
      if (!aviso) {
        res.status(404).json({ message: "Aviso não encontrado." });
        return;
      }
      await prisma.notification.update({
        where: { id: aviso.id },
        data: { readAt: new Date() },
      });

      /*
        O outro lado da mesma pendência: tocar o aviso do mural no sino
        também o marca como lido no mural. [B2-3-A]
      */
      if (aviso.entityType === "Announcement" && aviso.entityId) {
        await prisma.announcementRead
          .upsert({
            where: {
              announcementId_userId: {
                announcementId: aviso.entityId,
                userId,
              },
            },
            create: { announcementId: aviso.entityId, userId },
            update: {},
          })
          .catch(() => {
            /* aviso apagado não impede marcar a notificação */
          });
      }

      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  }

  async markAllRead(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const userId = actorUserId(auth);
      // Marcar tudo como lido no sino também limpa os avisos do mural. [B2-3-A]
      const avisos = await prisma.notification.findMany({
        where: {
          userId,
          organizationId: actorOrgId(auth),
          readAt: null,
          entityType: "Announcement",
        },
        select: { entityId: true },
      });
      for (const a of avisos) {
        if (!a.entityId) continue;
        await prisma.announcementRead
          .upsert({
            where: {
              announcementId_userId: { announcementId: a.entityId, userId },
            },
            create: { announcementId: a.entityId, userId },
            update: {},
          })
          .catch(() => {
            /* aviso apagado não impede marcar a notificação */
          });
      }

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
