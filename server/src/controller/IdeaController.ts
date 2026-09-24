import { Request, Response } from "express";
import prisma from "../model/prisma";
import { Idea } from "../model/schema/Idea/Idea";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { can } from "../helper/permissions";
import {
  IDEA_STATUSES,
  IDEA_STATUSES_NEEDING_NOTE,
  IDEA_STATUS_VALUES,
  isIdeaStatus,
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
  return Boolean(req.actor && can(req.actor.permission, "rh"));
}

class IdeaController {
  async list(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const status = req.query.status as string | undefined;
      const mine = req.query.mine === "true";

      const rows = await prisma.idea.findMany({
        where: {
          organizationId: orgId,
          ...(status && isIdeaStatus(status) ? { status } : {}),
          ...(!isRh(auth) || mine
            ? { authorUserId: actorUserId(auth) }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        include: {
          author: { select: { id: true, name: true } },
          decidedBy: { select: { id: true, name: true } },
        },
      });
      res.json({ ideas: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async get(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const idea = await prisma.idea.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: {
          author: { select: { id: true, name: true } },
          decidedBy: { select: { id: true, name: true } },
        },
      });
      if (!idea) {
        res.status(404).json({ message: "Ideia não encontrada." });
        return;
      }
      if (!isRh(auth) && idea.authorUserId !== actorUserId(auth)) {
        res.status(403).json({ message: "Sem permissão." });
        return;
      }
      res.json({ idea });
    } catch (err) {
      fail(res, err);
    }
  }

  async create(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const { title, description } = req.body as {
        title?: string;
        description?: string;
      };

      if (!title?.trim() || !description?.trim()) {
        res.status(400).json({ message: "Informe title e description." });
        return;
      }

      const idea = await new Idea().create.new({
        organizationId: orgId,
        authorUserId: userId,
        title: title.trim(),
        description: description.trim(),
        status: IDEA_STATUSES.NEW,
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "idea.create",
        entityType: "Idea",
        entityId: idea.id,
      });

      res.status(201).json({ idea });
    } catch (err) {
      fail(res, err);
    }
  }

  /** Autor pode editar enquanto NEW. */
  async update(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const current = await new Idea().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!current) {
        res.status(404).json({ message: "Ideia não encontrada." });
        return;
      }
      if (current.authorUserId !== userId) {
        res.status(403).json({ message: "Só o autor pode editar." });
        return;
      }
      if (current.status !== IDEA_STATUSES.NEW) {
        res.status(409).json({
          message: "Ideia em análise ou decidida não pode ser editada.",
        });
        return;
      }

      const body = req.body as { title?: string; description?: string };
      const idea = await new Idea().update.one(
        { id: current.id, organizationId: orgId },
        {
          ...(body.title !== undefined
            ? { title: String(body.title).trim() }
            : {}),
          ...(body.description !== undefined
            ? { description: String(body.description).trim() }
            : {}),
        },
      );
      res.json({ idea });
    } catch (err) {
      fail(res, err);
    }
  }

  /** RH decide: IN_ANALYSIS | IMPLEMENTED | REJECTED. */
  async decide(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const current = await new Idea().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!current) {
        res.status(404).json({ message: "Ideia não encontrada." });
        return;
      }

      const { status, decision_note } = req.body as {
        status?: string;
        decision_note?: string;
      };

      if (!status || !isIdeaStatus(status)) {
        res.status(400).json({
          message: `status inválido. Use: ${IDEA_STATUS_VALUES.join(", ")}.`,
        });
        return;
      }
      if (status === IDEA_STATUSES.NEW) {
        res.status(400).json({
          message: "Use IN_ANALYSIS, IMPLEMENTED ou REJECTED.",
        });
        return;
      }

      const note = blank(decision_note);
      if (IDEA_STATUSES_NEEDING_NOTE.includes(status) && !note) {
        res.status(400).json({
          message: "Informe decision_note ao implementar ou rejeitar.",
        });
        return;
      }

      const idea = await new Idea().update.one(
        { id: current.id, organizationId: orgId },
        {
          status,
          decisionNote: note ?? current.decisionNote,
          decidedById: userId,
          decidedAt: new Date(),
        },
      );

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "idea.decide",
        entityType: "Idea",
        entityId: current.id,
        after: { status },
      });

      res.json({ idea });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new IdeaController();
