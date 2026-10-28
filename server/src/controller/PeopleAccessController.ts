import bcrypt from "bcryptjs";
import { AccessSuspensionReason, Role } from "@prisma/client";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { effectivePermission, orgRoleToAccountRole } from "../helper/auth";
import { assignableOrgRoles, canAssignOrgRole } from "../helper/invite-access";
import { modulesForRole } from "../helper/module-access";
import { accessEnded, resolveAccessUntil } from "../helper/access-period";
import { temporaryPassword } from "../helper/temporary-password";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
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
          suspendedAt: true,
          suspensionReason: true,
          suspendedBy: { select: { id: true, name: true } },
          user: {
            select: {
              id: true,
              name: true,
              login: true,
              email: true,
              active: true,
              mustChangePassword: true,
              employeeProfiles: {
                where: { organizationId: orgId },
                take: 1,
                select: {
                  registration: true,
                  dismissedAt: true,
                  dismissedBy: { select: { name: true } },
                  jobRole: { select: { name: true } },
                },
              },
            },
          },
        },
      });

      const people = rows
        .map((m) => {
          const permission = effectivePermission(m.role);
          const profile = m.user.employeeProfiles[0] ?? null;
          /*
            Desligado, suspenso e prazo vencido apareciam todos como "Sem
            acesso": o dono não tinha como saber quem saiu, quem foi
            bloqueado e quem só precisa de renovação. [S6-C] [CB-39]
          */
          const situacao = !m.user.active
            ? "inactive"
            : m.suspendedAt
              ? m.suspensionReason === "DISMISSAL"
                ? "dismissed"
                : "suspended"
              : accessEnded(m.accessExpiresAt)
                ? "expired"
                : "active";
          return {
            id: m.user.id,
            name: m.user.name,
            login: m.user.login,
            email: m.user.email,
            active: situacao === "active",
            status: situacao,
            /*
              "Desligado desde" é a data do desligamento, não o instante em
              que o RH o registrou — a ficha mostra a mesma data. [B3-1-E]
            */
            status_since:
              situacao === "dismissed"
                ? (profile?.dismissedAt ?? m.suspendedAt)
                : (m.suspendedAt ?? profile?.dismissedAt ?? m.accessExpiresAt),
            status_by:
              m.suspendedBy?.name ?? profile?.dismissedBy?.name ?? null,
            must_change_password: m.user.mustChangePassword,
            org_role: m.role,
            permission,
            modules: modulesForRole(permission),
            access_expires_at: m.accessExpiresAt,
            job_role: profile?.jobRole?.name ?? null,
            registration: profile?.registration ?? null,
            can_reset_password: m.user.id !== actor.userId && canAssignOrgRole(actor, m.role),
            can_change_role: m.user.id !== actor.userId && canAssignOrgRole(actor, m.role),
            /// Suspender não é desligar: tirar o acesso de quem continua na
            /// empresa não pode exigir um desligamento inventado. [CB-44]
            can_suspend:
              m.user.id !== actor.userId &&
              canAssignOrgRole(actor, m.role) &&
              situacao !== "dismissed",
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

      res.json({
        people,
        assignable: { org_roles: assignableOrgRoles(actor) },
      });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Suspender e devolver o acesso de quem continua na empresa.
   *
   * Antes, tirar o acesso de alguém que não é fiscal só se fazia registrando
   * um desligamento — com data e motivo, como se a pessoa tivesse saído. Ficava
   * no histórico uma saída que não aconteceu. [CB-44] [S6-C]
   */
  async setAccess(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const actor = auth.actor!;
      const orgId = actorOrgId(auth);
      const targetId = req.params.userId;
      const { suspend, reason } = req.body as { suspend?: boolean; reason?: string };

      if (typeof suspend !== "boolean") {
        res.status(400).json({ message: "Informe suspend: true ou false." });
        return;
      }
      if (targetId === actorUserId(auth)) {
        res.status(400).json({ message: "Você não pode suspender o seu próprio acesso." });
        return;
      }

      const membership = await prisma.membership.findFirst({
        where: { organizationId: orgId, userId: targetId },
        select: { id: true, role: true, suspendedAt: true, suspensionReason: true },
      });
      if (!membership) {
        res.status(404).json({ message: "Pessoa não encontrada nesta organização." });
        return;
      }
      if (!canAssignOrgRole(actor, membership.role)) {
        res.status(403).json({
          message: "Você só pode mexer no acesso de quem está abaixo do seu.",
        });
        return;
      }
      /*
        Quem saiu da empresa volta pela ficha, com "reverter desligamento":
        devolver o acesso por aqui deixaria a ficha dizendo que a pessoa foi
        desligada e o portal deixando ela entrar. [S5-H]
      */
      if (membership.suspensionReason === "DISMISSAL") {
        res.status(409).json({
          message:
            "Esta pessoa foi desligada. Para devolver o acesso, reverta o desligamento na ficha dela.",
        });
        return;
      }

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.membership.update({
          where: { id: membership.id },
          data: suspend
            ? {
                suspendedAt: new Date(),
                suspensionReason: AccessSuspensionReason.MANUAL,
                suspendedById: actor.userId,
              }
            : { suspendedAt: null, suspensionReason: null, suspendedById: null },
        });
        // Suspensão derruba a sessão aberta na hora.
        if (suspend) await tx.token.deleteMany({ where: { userId: targetId } });
        return row;
      });

      await writeAudit({
        organizationId: orgId,
        actorId: actor.userId,
        action: suspend ? "membership.suspend" : "membership.restore",
        entityType: "User",
        entityId: targetId,
        after: { reason: reason?.trim() || null },
      });

      res.json({
        ok: true,
        suspended: Boolean(updated.suspendedAt),
      });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Muda o papel de quem já está na organização. [S1-O]
   *
   * Mesmas regras de quem aprova a entrada: só quem cuida de Conta e
   * usuários, só de quem está abaixo e só para papéis abaixo do seu. O papel
   * na conta vem junto porque ele manda no papel efetivo (ADMIN da conta vale
   * como ADM loja, qualquer que seja o papel na empresa). Vale na hora: a
   * permissão é lida do banco a cada requisição.
   */
  async changeRole(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const actor = auth.actor!;
      const orgId = actorOrgId(auth);
      const targetId = req.params.userId;
      const body = req.body as { org_role?: string; access_until?: string };

      if (targetId === actorUserId(auth)) {
        res.status(400).json({ message: "Você não pode mudar o seu próprio papel." });
        return;
      }
      const membership = await prisma.membership.findFirst({
        where: { organizationId: orgId, userId: targetId },
        select: { id: true, role: true, accessExpiresAt: true },
      });
      if (!membership) {
        res.status(404).json({ message: "Pessoa não encontrada nesta organização." });
        return;
      }
      if (!canAssignOrgRole(actor, membership.role)) {
        res.status(403).json({ message: "Você só pode mudar o papel de quem está abaixo do seu." });
        return;
      }

      const orgRole = body.org_role as Role | undefined;
      if (!orgRole || !Object.values(Role).includes(orgRole)) {
        res.status(400).json({ message: "Informe o papel na empresa (org_role)." });
        return;
      }
      if (!canAssignOrgRole(actor, orgRole)) {
        res.status(403).json({ message: "Você só pode dar papéis abaixo do seu." });
        return;
      }

      /*
        O papel na conta não se escolhe mais: ele acompanha o da empresa, para
        que as duas telas nunca mais mostrem papéis diferentes da mesma
        pessoa. [OB-3] [S1-C]
      */
      const link = await prisma.accountMembership.findFirst({
        where: { accountId: actor.accountId, userId: targetId },
        select: { id: true, role: true },
      });
      const accountRole = link ? orgRoleToAccountRole(orgRole) : null;

      // Fiscal sempre com prazo; quem deixa de ser fiscal perde o prazo. [S7-A]
      const accessExpiresAt =
        orgRole === Role.FISCAL
          ? membership.role === Role.FISCAL && body.access_until === undefined
            ? membership.accessExpiresAt
            : resolveAccessUntil(body.access_until)
          : null;

      await prisma.$transaction([
        prisma.membership.update({
          where: { id: membership.id },
          data: { role: orgRole, accessExpiresAt },
        }),
        ...(link && accountRole && accountRole !== link.role
          ? [prisma.accountMembership.update({ where: { id: link.id }, data: { role: accountRole } })]
          : []),
      ]);

      await writeAudit({
        organizationId: orgId,
        actorId: actor.userId,
        action: "membership.role_changed",
        entityType: "User",
        entityId: targetId,
        before: { orgRole: membership.role, accountRole: link?.role ?? null },
        after: { orgRole, accountRole, accessExpiresAt },
      });

      const permission = effectivePermission(orgRole);
      res.json({
        person: {
          id: targetId,
          org_role: orgRole,
          permission,
          modules: modulesForRole(permission),
          access_expires_at: accessExpiresAt,
        },
      });
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
