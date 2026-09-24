import { Request, Response } from "express";
import prisma from "../model/prisma";
import { Announcement } from "../model/schema/Announcement/Announcement";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import {
  ANNOUNCEMENT_KIND_DEFAULT,
  ANNOUNCEMENT_KIND_VALUES,
  isAnnouncementKind,
} from "../constants";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

class AnnouncementController {
  async list(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const kind = req.query.kind as string | undefined;
      const includeExpired = req.query.include_expired === "true";
      const now = new Date();

      const rows = await prisma.announcement.findMany({
        where: {
          organizationId: orgId,
          ...(kind && isAnnouncementKind(kind) ? { kind } : {}),
          ...(includeExpired
            ? {}
            : {
                OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
              }),
        },
        orderBy: { createdAt: "desc" },
        include: {
          publishedBy: { select: { id: true, name: true } },
          reads: {
            where: { userId },
            select: { readAt: true },
          },
          _count: { select: { reads: true } },
        },
      });

      res.json({
        announcements: rows.map((a) => ({
          ...a,
          read_at: a.reads[0]?.readAt ?? null,
          reads: undefined,
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
      const announcement = await prisma.announcement.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: {
          publishedBy: { select: { id: true, name: true } },
          reads: {
            where: { userId },
            select: { readAt: true },
          },
          _count: { select: { reads: true } },
        },
      });
      if (!announcement) {
        res.status(404).json({ message: "Aviso não encontrado." });
        return;
      }
      res.json({
        announcement: {
          ...announcement,
          read_at: announcement.reads[0]?.readAt ?? null,
          reads: undefined,
        },
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async create(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const { kind, title, body, happens_at, expires_at } = req.body as {
        kind?: string;
        title?: string;
        body?: string;
        happens_at?: string;
        expires_at?: string;
      };

      if (!title?.trim() || !body?.trim()) {
        res.status(400).json({ message: "Informe title e body." });
        return;
      }

      const resolvedKind = kind
        ? isAnnouncementKind(kind)
          ? kind
          : null
        : ANNOUNCEMENT_KIND_DEFAULT;
      if (!resolvedKind) {
        res.status(400).json({
          message: `kind inválido. Use: ${ANNOUNCEMENT_KIND_VALUES.join(", ")}.`,
        });
        return;
      }

      const announcement = await new Announcement().create.new({
        organizationId: orgId,
        kind: resolvedKind,
        title: title.trim(),
        body: body.trim(),
        happensAt: happens_at ? new Date(happens_at) : null,
        expiresAt: expires_at ? new Date(expires_at) : null,
        publishedById: userId,
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "announcement.create",
        entityType: "Announcement",
        entityId: announcement.id,
        after: { kind: announcement.kind },
      });

      res.status(201).json({ announcement });
    } catch (err) {
      fail(res, err);
    }
  }

  /** Confirma leitura — prova de comunicação (NR-1 / Lei 14.457). */
  async markRead(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const announcement = await new Announcement().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!announcement) {
        res.status(404).json({ message: "Aviso não encontrado." });
        return;
      }

      const read = await prisma.announcementRead.upsert({
        where: {
          announcementId_userId: {
            announcementId: announcement.id,
            userId,
          },
        },
        create: {
          announcementId: announcement.id,
          userId,
        },
        update: {},
      });

      res.json({ read });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new AnnouncementController();
