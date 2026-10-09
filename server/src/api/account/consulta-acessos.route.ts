import { Router, Request, Response } from "express";
import prisma from "../../model/prisma";
import { verifyModule } from "../../model/lib/Auth";
import { Role } from "@prisma/client";
import { actorOrgId, actorUserId } from "../../helper/org-scope";
import { accessEnded, resolveAccessUntil } from "../../helper/access-period";
import { writeAudit } from "../../helper/audit";
import type { AuthRequest } from "../../types/auth";

const router = Router();

/**
 * O que a consulta (fiscal) abriu no portal, mais recente primeiro. Quem dá
 * o acesso — Conta e usuários — vê o que foi consultado. [S7-A]
 */
router.get(
  "/api/consulta-acessos",
  verifyModule("conta", "write"),
  async (req: Request, res: Response) => {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const rows = await prisma.auditEvent.findMany({
        where: { organizationId: orgId, action: "consulta.view" },
        orderBy: { createdAt: "desc" },
        take: 500,
        select: {
          id: true,
          entityId: true,
          createdAt: true,
          actor: { select: { id: true, name: true } },
        },
      });
      res.json({
        acessos: rows.map((r) => ({
          id: r.id,
          path: r.entityId,
          at: r.createdAt,
          user: r.actor,
        })),
      });
    } catch (err) {
      fail(res, err);
    }
  },
);

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

/** Quem tem acesso de fiscal e até quando. [S7-A] */
router.get(
  "/api/fiscais",
  verifyModule("conta", "write"),
  async (req: Request, res: Response) => {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const rows = await prisma.membership.findMany({
        where: { organizationId: orgId, role: Role.FISCAL },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          accessExpiresAt: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true } },
        },
      });
      res.json({
        fiscais: rows.map((m) => ({
          id: m.id,
          user: m.user,
          access_expires_at: m.accessExpiresAt,
          active: !accessEnded(m.accessExpiresAt),
          since: m.createdAt,
        })),
      });
    } catch (err) {
      fail(res, err);
    }
  },
);

/**
 * Muda o fim do acesso do fiscal: nova data (`access_until`, AAAA-MM-DD) ou
 * encerrar agora (`end_now: true`). Fica na trilha de auditoria.
 */
router.patch(
  "/api/fiscais/:id",
  verifyModule("conta", "write"),
  async (req: Request, res: Response) => {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const current = await prisma.membership.findFirst({
        where: { id: req.params.id, organizationId: orgId, role: Role.FISCAL },
        select: { id: true, accessExpiresAt: true },
      });
      if (!current) {
        res.status(404).json({ message: "Fiscal não encontrado." });
        return;
      }
      const body = req.body as { access_until?: string; end_now?: boolean };
      const until = body.end_now === true ? new Date() : resolveAccessUntil(body.access_until);
      const updated = await prisma.membership.update({
        where: { id: current.id },
        data: { accessExpiresAt: until },
        select: { id: true, accessExpiresAt: true },
      });
      await writeAudit({
        organizationId: orgId,
        actorId: actorUserId(auth),
        action: body.end_now === true ? "fiscal.access_ended" : "fiscal.access_changed",
        entityType: "Membership",
        entityId: current.id,
        before: { accessExpiresAt: current.accessExpiresAt },
        after: { accessExpiresAt: updated.accessExpiresAt },
      });
      res.json({
        fiscal: {
          id: updated.id,
          access_expires_at: updated.accessExpiresAt,
          active: !accessEnded(updated.accessExpiresAt),
        },
      });
    } catch (err) {
      fail(res, err);
    }
  },
);

export default router;
