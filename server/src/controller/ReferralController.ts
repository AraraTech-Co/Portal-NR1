import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { canManageModule } from "../helper/module-access";
import {
  REFERRAL_STATUSES,
  REFERRAL_STATUS_VALUES,
  isReferralStatus,
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
  return Boolean(req.actor && canManageModule(req.actor.permission, "talentos"));
}

class ReferralController {
  async list(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const rows = await prisma.referral.findMany({
        where: {
          organizationId: orgId,
          ...(!isRh(auth) ? { referrerUserId: userId } : {}),
        },
        orderBy: { createdAt: "desc" },
      });
      res.json({ referrals: rows });
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
        candidate_name,
        email,
        phone,
        position,
        linkedin,
        note,
      } = req.body as Record<string, string | undefined>;

      if (!candidate_name?.trim() || !position?.trim()) {
        res.status(400).json({
          message: "Informe candidate_name e position.",
        });
        return;
      }

      const referral = await prisma.referral.create({
        data: {
          organizationId: orgId,
          referrerUserId: userId,
          candidateName: candidate_name.trim(),
          email: blank(email),
          phone: blank(phone),
          position: position.trim(),
          linkedin: blank(linkedin),
          note: blank(note),
          status: REFERRAL_STATUSES.RECEIVED,
        },
      });
      res.status(201).json({ referral });
    } catch (err) {
      fail(res, err);
    }
  }

  async updateStatus(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const current = await prisma.referral.findFirst({
        where: { id: req.params.id, organizationId: orgId },
      });
      if (!current) {
        res.status(404).json({ message: "Indicação não encontrada." });
        return;
      }
      const { status } = req.body as { status?: string };
      if (!status || !isReferralStatus(status)) {
        res.status(400).json({
          message: `status inválido. Use: ${REFERRAL_STATUS_VALUES.join(", ")}.`,
        });
        return;
      }
      const referral = await prisma.referral.update({
        where: { id: current.id },
        data: { status },
      });
      res.json({ referral });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new ReferralController();
