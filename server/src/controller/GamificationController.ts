import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { canManageModule } from "../helper/module-access";
import {
  REDEMPTION_STATUSES,
  isRedemptionStatus,
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
  return Boolean(req.actor && canManageModule(req.actor.permission, "gamificacao"));
}

class GamificationController {
  async listPointRules(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const rows = await prisma.pointRule.findMany({
        where: { organizationId: orgId },
        orderBy: { activity: "asc" },
      });
      res.json({ rules: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async upsertPointRule(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const { activity, points } = req.body as {
        activity?: string;
        points?: number;
      };
      if (!activity?.trim() || typeof points !== "number") {
        res.status(400).json({ message: "Informe activity e points." });
        return;
      }
      const rule = await prisma.pointRule.upsert({
        where: {
          organizationId_activity: {
            organizationId: orgId,
            activity: activity.trim(),
          },
        },
        create: {
          organizationId: orgId,
          activity: activity.trim(),
          points,
        },
        update: { points },
      });
      res.status(201).json({ rule });
    } catch (err) {
      fail(res, err);
    }
  }

  async grantPoints(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const granterId = actorUserId(auth);
      const { user_id, activity, points, note } = req.body as {
        user_id?: string;
        activity?: string;
        points?: number;
        note?: string;
      };
      if (!user_id || !activity?.trim() || typeof points !== "number") {
        res.status(400).json({
          message: "Informe user_id, activity e points.",
        });
        return;
      }
      const entry = await prisma.pointEntry.create({
        data: {
          organizationId: orgId,
          userId: user_id,
          activity: activity.trim(),
          points,
          note: blank(note),
          grantedById: granterId,
        },
      });
      res.status(201).json({ entry });
    } catch (err) {
      fail(res, err);
    }
  }

  async myBalance(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const agg = await prisma.pointEntry.aggregate({
        where: { organizationId: orgId, userId },
        _sum: { points: true },
      });
      res.json({ balance: agg._sum.points ?? 0 });
    } catch (err) {
      fail(res, err);
    }
  }

  async listRewards(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const rows = await prisma.reward.findMany({
        where: { organizationId: orgId, archivedAt: null },
        orderBy: { cost: "asc" },
      });
      res.json({ rewards: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async createReward(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const { name, description, cost, stock } = req.body as {
        name?: string;
        description?: string;
        cost?: number;
        stock?: number;
      };
      if (!name?.trim() || typeof cost !== "number") {
        res.status(400).json({ message: "Informe name e cost." });
        return;
      }
      const reward = await prisma.reward.create({
        data: {
          organizationId: orgId,
          name: name.trim(),
          description: blank(description),
          cost,
          stock: stock ?? null,
        },
      });
      res.status(201).json({ reward });
    } catch (err) {
      fail(res, err);
    }
  }

  async redeem(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const reward = await prisma.reward.findFirst({
        where: {
          id: req.params.id,
          organizationId: orgId,
          archivedAt: null,
        },
      });
      if (!reward) {
        res.status(404).json({ message: "Recompensa não encontrada." });
        return;
      }
      if (reward.stock !== null && reward.stock <= 0) {
        res.status(409).json({ message: "Sem estoque." });
        return;
      }

      const agg = await prisma.pointEntry.aggregate({
        where: { organizationId: orgId, userId },
        _sum: { points: true },
      });
      const balance = agg._sum.points ?? 0;
      if (balance < reward.cost) {
        res.status(400).json({ message: "Pontos insuficientes." });
        return;
      }

      const redemption = await prisma.$transaction(async (tx) => {
        const created = await tx.rewardRedemption.create({
          data: {
            rewardId: reward.id,
            userId,
            cost: reward.cost,
            status: REDEMPTION_STATUSES.REQUESTED,
          },
        });
        await tx.pointEntry.create({
          data: {
            organizationId: orgId,
            userId,
            activity: `redeem:${reward.id}`,
            points: -reward.cost,
            note: `Resgate: ${reward.name}`,
          },
        });
        if (reward.stock !== null) {
          await tx.reward.update({
            where: { id: reward.id },
            data: { stock: { decrement: 1 } },
          });
        }
        return created;
      });

      res.status(201).json({ redemption });
    } catch (err) {
      fail(res, err);
    }
  }

  async decideRedemption(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const deciderId = actorUserId(auth);
      const redemption = await prisma.rewardRedemption.findFirst({
        where: {
          id: req.params.redemptionId,
          reward: { organizationId: orgId },
        },
      });
      if (!redemption) {
        res.status(404).json({ message: "Resgate não encontrado." });
        return;
      }
      const { status } = req.body as { status?: string };
      if (
        status !== REDEMPTION_STATUSES.APPROVED &&
        status !== REDEMPTION_STATUSES.DELIVERED &&
        status !== REDEMPTION_STATUSES.REJECTED
      ) {
        res.status(400).json({
          message: "status: APPROVED, DELIVERED ou REJECTED.",
        });
        return;
      }
      const updated = await prisma.rewardRedemption.update({
        where: { id: redemption.id },
        data: {
          status,
          decidedById: deciderId,
          decidedAt: new Date(),
        },
      });
      res.json({ redemption: updated });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new GamificationController();
