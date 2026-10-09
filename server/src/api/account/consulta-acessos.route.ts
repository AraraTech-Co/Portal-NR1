import { Router, Request, Response } from "express";
import prisma from "../../model/prisma";
import { verifyModule } from "../../model/lib/Auth";
import { actorOrgId } from "../../helper/org-scope";
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
      const e = err as { status?: number; message?: string };
      res.status(e.status || 500).json({ message: e.message || "Erro interno." });
    }
  },
);

export default router;
