import { randomInt } from "crypto";
import bcrypt from "bcryptjs";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { effectivePermission } from "../helper/auth";
import { canAssignOrgRole } from "../helper/invite-access";
import { modulesForRole } from "../helper/module-access";
import { accessEnded } from "../helper/access-period";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

/** Sem 0/O, 1/l/I: a senha vai ser ditada ou digitada à mão. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function temporaryPassword(length = 12): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

class PeopleAccessController {
  /**
   * Quem está na organização, com o papel e o que ele pode fazer em cada
   * tela. [S1-B]
   */
  async list(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const actor = auth.actor!;
      const orgId = actorOrgId(auth);
      const rows = await prisma.membership.findMany({
        where: { organizationId: orgId },
        select: {
          role: true,
          accessExpiresAt: true,
          user: {
            select: {
              id: true,
              name: true,
              login: true,
              email: true,
              active: true,
              mustChangePassword: true,
              accountMemberships: {
                where: { accountId: actor.accountId },
                select: { role: true },
              },
              employeeProfiles: {
                where: { organizationId: orgId },
                take: 1,
                select: { registration: true, jobRole: { select: { name: true } } },
              },
            },
          },
        },
      });

      const people = rows
        .map((m) => {
          const accountRole = m.user.accountMemberships[0]?.role ?? null;
          const permission = effectivePermission(m.role, accountRole);
          const profile = m.user.employeeProfiles[0] ?? null;
          return {
            id: m.user.id,
            name: m.user.name,
            login: m.user.login,
            email: m.user.email,
            active: m.user.active && !accessEnded(m.accessExpiresAt),
            must_change_password: m.user.mustChangePassword,
            org_role: m.role,
            account_role: accountRole,
            permission,
            modules: modulesForRole(permission),
            access_expires_at: m.accessExpiresAt,
            job_role: profile?.jobRole?.name ?? null,
            registration: profile?.registration ?? null,
            can_reset_password: m.user.id !== actor.userId && canAssignOrgRole(actor, m.role),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

      res.json({ people });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Redefine a senha de outra pessoa: gera uma provisória, mostrada UMA vez a
   * quem redefiniu, exige troca no primeiro acesso e derruba as sessões
   * abertas. Só para quem está abaixo na hierarquia; a própria senha se troca
   * em "Trocar senha". [S1-D]
   */
  async resetPassword(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const actor = auth.actor!;
      const orgId = actorOrgId(auth);
      const targetId = req.params.userId;

      if (targetId === actorUserId(auth)) {
        res.status(400).json({ message: "Para a sua própria senha, use Trocar senha." });
        return;
      }
      const membership = await prisma.membership.findFirst({
        where: { organizationId: orgId, userId: targetId },
        select: { role: true, user: { select: { id: true, name: true, active: true } } },
      });
      if (!membership) {
        res.status(404).json({ message: "Pessoa não encontrada nesta organização." });
        return;
      }
      if (!canAssignOrgRole(actor, membership.role)) {
        res.status(403).json({
          message: "Você só pode redefinir a senha de quem está abaixo do seu papel.",
        });
        return;
      }
      if (!membership.user.active) {
        res.status(409).json({ message: "Usuário desativado: reative antes de redefinir a senha." });
        return;
      }

      const password = temporaryPassword();
      const passwordHash = await bcrypt.hash(password, 10);
      await prisma.$transaction([
        prisma.user.update({
          where: { id: targetId },
          data: { passwordHash, mustChangePassword: true },
        }),
        prisma.token.deleteMany({ where: { userId: targetId } }),
      ]);

      await writeAudit({
        organizationId: orgId,
        actorId: actor.userId,
        action: "user.password_reset",
        entityType: "User",
        entityId: targetId,
      });

      res.setHeader("Cache-Control", "no-store");
      res.json({
        user: { id: membership.user.id, name: membership.user.name },
        temporary_password: password,
      });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new PeopleAccessController();
