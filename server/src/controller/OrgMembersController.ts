import { Role } from "@prisma/client";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { profileScope, scopeOfRequest } from "../helper/unit-scope";
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
      /*
        Quem aparece como responsável por documento ou por ação: gente que
        trabalha aqui. O fiscal só consulta e não assina nada; o desligado
        não responde por mais nada. [CB-49] [CB-23]
      */
      /*
        Gerente, supervisor e ADM loja escolhem entre as pessoas das unidades
        geridas (e a si mesmos); o colaborador, só a si. [C2-13]
      */
      const escopo = await scopeOfRequest(req as AuthRequest);
      const alcance = escopo.wholeOrg
        ? {}
        : {
            OR: [
              { userId: actorUserId(req as AuthRequest) },
              { user: { employeeProfiles: { some: { organizationId: orgId, ...profileScope(escopo) } } } },
            ],
          };
      const rows = await prisma.membership.findMany({
        where: {
          organizationId: orgId,
          role: { not: Role.FISCAL },
          ...alcance,
          user: {
            active: true,
            employeeProfiles: {
              none: { organizationId: orgId, dismissedAt: { not: null } },
            },
          },
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
