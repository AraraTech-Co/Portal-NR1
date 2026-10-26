import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { canManageModule } from "../helper/module-access";
import { writeAudit } from "../helper/audit";
import { notify, notifyMany } from "../helper/notify";
import { usersWhoManageRewards } from "../helper/module-managers";
import { NotificationKind } from "@prisma/client";
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
      /*
        Ponto é valor: vira prêmio. Lançar pontos para alguém não entrava na
        trilha, e numa contestação não havia como mostrar quem lançou nem
        por quê. [CB-67]
      */
      await writeAudit({
        organizationId: orgId,
        actorId: granterId,
        action: "gamification.points",
        entityType: "PointEntry",
        entityId: entry.id,
        after: {
          userId: entry.userId,
          activity: entry.activity,
          points: entry.points,
        },
      });

      /*
        A gamificação só funciona se o trabalhador souber que ganhou: o saldo
        aparecia sem nunca ter sido anunciado, e quem recebeu descobria por
        acaso ao entrar na tela. [B3-3-F]
      */
      if (entry.userId !== granterId) {
        await notify({
          organizationId: orgId,
          userId: entry.userId,
          kind: NotificationKind.POINTS_GRANTED,
          title: `+${entry.points} ponto(s)`,
          body: entry.activity,
          link: "/gamificacao",
          entityType: "PointEntry",
          entityId: entry.id,
        });
      }

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
      /* O prêmio e o custo dele em pontos entram na trilha. [CB-67] */
      await writeAudit({
        organizationId: orgId,
        actorId: actorUserId(req as AuthRequest),
        action: "gamification.reward",
        entityType: "Reward",
        entityId: reward.id,
        after: { name: reward.name, cost: reward.cost, stock: reward.stock },
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

      /*
        O resgate pedido ficava parado até alguém do RH entrar na tela por
        acaso. [B3-3-F] [CB-29]
      */
      const quemEntrega = await usersWhoManageRewards(orgId);
      await notifyMany(
        quemEntrega.filter((quem) => quem !== userId),
        {
          organizationId: orgId,
          kind: NotificationKind.REWARD_REQUESTED,
          title: "Resgate de prêmio pedido",
          body: `${reward.name} — esperando a entrega.`,
          link: "/gamificacao",
          entityType: "RewardRedemption",
          entityId: redemption.id,
        },
      );

      /* O resgate pedido: é quando os pontos saem do saldo. [CB-67] */
      await writeAudit({
        organizationId: orgId,
        actorId: actorUserId(req as AuthRequest),
        action: "gamification.redeem",
        entityType: "RewardRedemption",
        entityId: redemption.id,
        after: { rewardId: redemption.rewardId, cost: redemption.cost },
      });

      res.status(201).json({ redemption });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Os resgates pedidos — para quem entrega e para quem pediu.
   *
   * Decidir resgate já existia, mas nada listava os pedidos: quem entrega o
   * prêmio não tinha como saber que alguém pediu. [OB-4]
   */
  async listRedemptions(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const cuida = Boolean(
        auth.actor && canManageModule(auth.actor.permission, "gamificacao"),
      );
      const rows = await prisma.rewardRedemption.findMany({
        where: {
          reward: { organizationId: orgId },
          ...(cuida ? {} : { userId }),
        },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          status: true,
          cost: true,
          createdAt: true,
          decidedAt: true,
          user: { select: { id: true, name: true } },
          reward: { select: { id: true, name: true } },
          decidedBy: { select: { id: true, name: true } },
        },
      });
      res.json({ redemptions: rows, manages: cuida });
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
      if (redemption.status === status) {
        res.status(409).json({
          message: "Este resgate já está assim.",
          code: "ALREADY_DECIDED",
        });
        return;
      }

      const updated = await prisma.$transaction(async (tx) => {
        /*
          Quem pede paga os pontos na hora. Recusado, o pagamento volta — e
          o prêmio volta ao estoque. Sem isso, a pessoa perdia os pontos por
          um resgate que ninguém entregou. [OB-4]
        */
        if (
          status === REDEMPTION_STATUSES.REJECTED &&
          redemption.status !== REDEMPTION_STATUSES.REJECTED
        ) {
          await tx.pointEntry.create({
            data: {
              organizationId: orgId,
              userId: redemption.userId,
              activity: `redeem_refund:${redemption.rewardId}`,
              points: redemption.cost,
              note: "Resgate recusado: pontos devolvidos.",
            },
          });
          await tx.reward.updateMany({
            where: { id: redemption.rewardId, stock: { not: null } },
            data: { stock: { increment: 1 } },
          });
        }
        return tx.rewardRedemption.update({
          where: { id: redemption.id },
          data: {
            status,
            decidedById: deciderId,
            decidedAt: new Date(),
          },
          select: {
            id: true,
            status: true,
            userId: true,
            reward: { select: { name: true } },
          },
        });
      });

      // Quem pediu precisa saber o que aconteceu com o pedido.
      await notify({
        organizationId: orgId,
        userId: updated.userId,
        kind: NotificationKind.REWARD_DECIDED,
        title: `Resgate: ${updated.reward.name}`,
        body:
          status === REDEMPTION_STATUSES.REJECTED
            ? "Recusado. Os pontos voltaram para o seu saldo."
            : status === REDEMPTION_STATUSES.DELIVERED
              ? "Entregue."
              : "Aprovado. Aguarde a entrega.",
        link: "/gamificacao",
        entityType: "RewardRedemption",
        entityId: updated.id,
      });

      /* E o que foi decidido sobre ele. [CB-67] */
      await writeAudit({
        organizationId: orgId,
        actorId: actorUserId(req as AuthRequest),
        action: "gamification.redeem_decide",
        entityType: "RewardRedemption",
        entityId: updated.id,
        after: { status: updated.status, reward: updated.reward.name },
      });

      res.json({ redemption: updated });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new GamificationController();
