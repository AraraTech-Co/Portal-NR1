import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId } from "../helper/org-scope";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

class OrgMembersController {
  /** Membros ativos da organização atual — para selects de pessoas. */
  async list(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const rows = await prisma.membership.findMany({
        where: {
          organizationId: orgId,
          user: { active: true },
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              login: true,
              employeeProfiles: {
                where: { organizationId: orgId },
                take: 1,
                select: {
                  registration: true,
                  jobRole: { select: { name: true } },
                },
              },
            },
          },
        },
      });

      const members = rows
        .map((r) => {
          const profile = r.user.employeeProfiles[0] ?? null;
          return {
            id: r.user.id,
            name: r.user.name,
            login: r.user.login,
            jobRoleName: profile?.jobRole?.name ?? null,
            registration: profile?.registration ?? null,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

      res.json({ members });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new OrgMembersController();
