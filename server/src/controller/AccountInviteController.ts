import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { AccountRole, InviteRoleMode, Role } from "@prisma/client";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { writeAudit } from "../helper/audit";
import {
  accountRoleToOrgRole,
  assertInviteLinkUsable,
  assignableAccountRoles,
  assignableOrgRoles,
  canAssignAccountRole,
  canAssignOrgRole,
  canDecideJoinRequests,
  canManageInviteLinks,
} from "../helper/invite-access";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function blank(v?: string | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

function loginCandidateFromEmail(email: string): string {
  const local = email.split("@")[0]?.toLowerCase().replace(/[^a-z0-9._-]/g, "") ||
    "user";
  return local.slice(0, 40) || "user";
}

async function allocateUniqueLogin(
  base: string,
  tx: { user: { findUnique: (args: { where: { login: string } }) => Promise<{ id: string } | null> } },
): Promise<string> {
  let candidate = base;
  for (let i = 0; i < 50; i++) {
    const exists = await tx.user.findUnique({ where: { login: candidate } });
    if (!exists) return candidate;
    candidate = `${base}-${i + 2}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function serializeLink(link: {
  id: string;
  token: string;
  label: string | null;
  roleMode: InviteRoleMode;
  role: AccountRole;
  orgRole: Role;
  active: boolean;
  expiresAt: Date | null;
  maxUses: number | null;
  usedCount: number;
  createdAt: Date;
}) {
  return {
    id: link.id,
    token: link.token,
    path: `/convite/${link.token}`,
    label: link.label,
    role_mode: link.roleMode,
    role: link.role,
    org_role: link.orgRole,
    active: link.active,
    expires_at: link.expiresAt,
    max_uses: link.maxUses,
    used_count: link.usedCount,
    created_at: link.createdAt,
  };
}

class AccountInviteController {
  async listLinks(req: Request, res: Response) {
    try {
      const actor = (req as AuthRequest).actor!;
      if (!canManageInviteLinks(actor)) {
        throw httpError(403, "Sem permissão para gerenciar convites.");
      }
      const links = await prisma.accountInviteLink.findMany({
        where: { accountId: actor.accountId },
        orderBy: [{ active: "desc" }, { createdAt: "desc" }],
      });
      res.json({
        links: links.map(serializeLink),
        assignable: {
          account_roles: assignableAccountRoles(actor),
          org_roles: assignableOrgRoles(actor),
        },
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async createLink(req: Request, res: Response) {
    try {
      const actor = (req as AuthRequest).actor!;
      if (!canManageInviteLinks(actor)) {
        throw httpError(403, "Sem permissão para gerenciar convites.");
      }

      const body = req.body as {
        label?: string;
        max_uses?: number | null;
        role_mode?: string;
        role?: string;
        org_role?: string;
      };

      const roleMode =
        body.role_mode === "FIXED" ? InviteRoleMode.FIXED : InviteRoleMode.ON_APPROVE;

      let role: AccountRole = AccountRole.USER;
      let orgRole: Role = Role.COLABORADOR;

      if (roleMode === InviteRoleMode.FIXED) {
        if (!body.role || !body.org_role) {
          throw httpError(400, "Com papel fixo, role e org_role são obrigatórios.");
        }
        if (!Object.values(AccountRole).includes(body.role as AccountRole)) {
          throw httpError(400, "role inválido.");
        }
        if (!Object.values(Role).includes(body.org_role as Role)) {
          throw httpError(400, "org_role inválido.");
        }
        role = body.role as AccountRole;
        orgRole = body.org_role as Role;
        if (!canAssignAccountRole(actor, role) || !canAssignOrgRole(actor, orgRole)) {
          throw httpError(403, "Você só pode conceder papéis abaixo do seu.");
        }
      }

      const maxUses =
        typeof body.max_uses === "number" && body.max_uses > 0
          ? Math.floor(body.max_uses)
          : null;

      const token = randomBytes(24).toString("base64url");
      const link = await prisma.accountInviteLink.create({
        data: {
          accountId: actor.accountId,
          token,
          roleMode,
          role,
          orgRole,
          label: blank(body.label),
          maxUses,
          createdById: actor.userId,
        },
      });

      await writeAudit({
        organizationId: actor.organizationId,
        actorId: actor.userId,
        action: "ACCOUNT_INVITE_LINK_CREATED",
        entityType: "AccountInviteLink",
        entityId: link.id,
        after: {
          accountId: actor.accountId,
          label: link.label,
          roleMode: link.roleMode,
          role: link.role,
          orgRole: link.orgRole,
        },
      });

      res.status(201).json({ link: serializeLink(link) });
    } catch (err) {
      fail(res, err);
    }
  }

  async deactivateLink(req: Request, res: Response) {
    try {
      const actor = (req as AuthRequest).actor!;
      if (!canManageInviteLinks(actor)) {
        throw httpError(403, "Sem permissão para gerenciar convites.");
      }
      const link = await prisma.accountInviteLink.findFirst({
        where: { id: req.params.id, accountId: actor.accountId },
      });
      if (!link) throw httpError(404, "Link de convite não encontrado.");
      if (!link.active) {
        res.json({ ok: true, id: link.id, active: false });
        return;
      }
      const updated = await prisma.accountInviteLink.update({
        where: { id: link.id },
        data: { active: false },
      });
      await writeAudit({
        organizationId: actor.organizationId,
        actorId: actor.userId,
        action: "ACCOUNT_INVITE_LINK_DEACTIVATED",
        entityType: "AccountInviteLink",
        entityId: link.id,
        after: { accountId: actor.accountId, label: link.label },
      });
      res.json({ ok: true, id: updated.id, active: updated.active });
    } catch (err) {
      fail(res, err);
    }
  }

  async getPublic(req: Request, res: Response) {
    try {
      const link = await prisma.accountInviteLink.findUnique({
        where: { token: req.params.token },
        include: {
          account: {
            select: {
              name: true,
              active: true,
              organization: { select: { name: true } },
            },
          },
        },
      });
      if (!link || !link.account.active) {
        throw httpError(404, "Convite não encontrado.");
      }
      assertInviteLinkUsable(link);
      res.json({
        account_name: link.account.name,
        organization_name: link.account.organization.name,
        label: link.label,
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async acceptPublic(req: Request, res: Response) {
    try {
      const { name, email, password, registration, is_external } = req.body as {
        name?: string;
        email?: string;
        password?: string;
        registration?: string;
        is_external?: boolean;
      };
      const link = await prisma.accountInviteLink.findUnique({
        where: { token: req.params.token },
        include: {
          account: {
            select: { id: true, name: true, active: true, organizationId: true },
          },
        },
      });
      if (!link || !link.account.active) {
        throw httpError(404, "Convite não encontrado.");
      }
      assertInviteLinkUsable(link);

      const cleanName = name?.trim() ?? "";
      const cleanEmail = email?.trim().toLowerCase() ?? "";
      if (!cleanName || !cleanEmail) {
        throw httpError(400, "Nome e e-mail são obrigatórios.");
      }
      if (!password || password.length < 8) {
        throw httpError(400, "A senha deve ter pelo menos 8 caracteres.");
      }

      const isExternal = is_external === true;
      const cleanRegistration = blank(registration);
      if (!isExternal && !cleanRegistration) {
        throw httpError(
          400,
          "Informe o número de cadastro ou selecione Externo.",
        );
      }
      if (isExternal && cleanRegistration) {
        throw httpError(
          400,
          "Externo não deve informar número de cadastro.",
        );
      }

      const existingMembership = await prisma.accountMembership.findFirst({
        where: { accountId: link.accountId, user: { email: cleanEmail } },
        select: { id: true },
      });
      if (existingMembership) {
        throw httpError(409, "Essa pessoa já está nesta conta.");
      }

      const existingUser = await prisma.user.findFirst({
        where: { email: cleanEmail },
        select: { id: true },
      });
      if (existingUser) {
        throw httpError(
          409,
          "Já existe uma conta com este e-mail. Entre pelo login.",
        );
      }

      const pendingSame = await prisma.accountJoinRequest.findFirst({
        where: {
          accountId: link.accountId,
          email: cleanEmail,
          status: "PENDING",
        },
        select: { id: true },
      });
      if (pendingSame) {
        throw httpError(409, "Já existe um pedido pendente com este e-mail.");
      }

      if (cleanRegistration) {
        const profileTaken = await prisma.employeeProfile.findFirst({
          where: {
            organizationId: link.account.organizationId,
            registration: cleanRegistration,
          },
          select: { id: true },
        });
        if (profileTaken) {
          throw httpError(
            409,
            "Este número de cadastro já está em uso nesta empresa.",
          );
        }
        const pendingReg = await prisma.accountJoinRequest.findFirst({
          where: {
            status: "PENDING",
            registration: cleanRegistration,
            isExternal: false,
            account: { organizationId: link.account.organizationId },
          },
          select: { id: true },
        });
        if (pendingReg) {
          throw httpError(
            409,
            "Já existe um pedido pendente com este número de cadastro.",
          );
        }
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const request = await prisma.$transaction(async (tx) => {
        const fresh = await tx.accountInviteLink.findUnique({
          where: { id: link.id },
        });
        if (!fresh) throw httpError(404, "Convite não encontrado.");
        assertInviteLinkUsable(fresh);

        const created = await tx.accountJoinRequest.create({
          data: {
            accountId: link.accountId,
            inviteLinkId: link.id,
            name: cleanName,
            email: cleanEmail,
            passwordHash,
            registration: isExternal ? null : cleanRegistration,
            isExternal,
            status: "PENDING",
          },
        });
        await tx.accountInviteLink.update({
          where: { id: link.id },
          data: { usedCount: { increment: 1 } },
        });
        return created;
      });

      res.status(201).json({
        ok: true,
        pending: true,
        email: cleanEmail,
        account_name: link.account.name,
        request_id: request.id,
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async listJoinRequests(req: Request, res: Response) {
    try {
      const actor = (req as AuthRequest).actor!;
      if (!canDecideJoinRequests(actor)) {
        throw httpError(403, "Sem permissão para decidir pedidos.");
      }

      const rows = await prisma.accountJoinRequest.findMany({
        where: {
          status: "PENDING",
          account: {
            organizationId: actor.organizationId,
            active: true,
            ...(actor.isMaster || canManageInviteLinks(actor)
              ? {}
              : { id: actor.accountId }),
          },
        },
        orderBy: { createdAt: "asc" },
        include: {
          account: { select: { id: true, name: true } },
        },
      });

      const linkIds = [
        ...new Set(
          rows
            .map((r) => r.inviteLinkId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const links =
        linkIds.length > 0
          ? await prisma.accountInviteLink.findMany({
              where: { id: { in: linkIds } },
              select: {
                id: true,
                roleMode: true,
                role: true,
                orgRole: true,
                label: true,
              },
            })
          : [];
      const linkById = new Map(links.map((l) => [l.id, l]));

      res.json({
        requests: rows.map((r) => {
          const link = r.inviteLinkId ? linkById.get(r.inviteLinkId) : undefined;
          return {
            id: r.id,
            account_id: r.accountId,
            account_name: r.account.name,
            name: r.name,
            email: r.email,
            registration: r.registration,
            is_external: r.isExternal,
            created_at: r.createdAt,
            invite_link_id: r.inviteLinkId,
            role_mode: link?.roleMode ?? InviteRoleMode.ON_APPROVE,
            suggested_role: link?.role ?? null,
            suggested_org_role: link?.orgRole ?? null,
            invite_label: link?.label ?? null,
          };
        }),
        assignable: {
          account_roles: assignableAccountRoles(actor),
          org_roles: assignableOrgRoles(actor),
        },
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async decideJoinRequest(req: Request, res: Response) {
    try {
      const actor = (req as AuthRequest).actor!;
      if (!canDecideJoinRequests(actor)) {
        throw httpError(403, "Sem permissão para decidir pedidos.");
      }

      const body = req.body as {
        action?: string;
        role?: string;
        org_role?: string;
        note?: string;
      };
      if (body.action !== "approve" && body.action !== "reject") {
        throw httpError(400, "action deve ser approve ou reject.");
      }

      const request = await prisma.accountJoinRequest.findFirst({
        where: {
          id: req.params.id,
          status: "PENDING",
          account: {
            organizationId: actor.organizationId,
            active: true,
          },
        },
        include: {
          account: {
            select: { id: true, organizationId: true, name: true },
          },
        },
      });
      if (!request) throw httpError(404, "Pedido não encontrado.");

      if (body.action === "reject") {
        await prisma.accountJoinRequest.update({
          where: { id: request.id },
          data: {
            status: "REJECTED",
            decidedById: actor.userId,
            decidedAt: new Date(),
            decisionNote: blank(body.note),
          },
        });
        await writeAudit({
          organizationId: actor.organizationId,
          actorId: actor.userId,
          action: "ACCOUNT_JOIN_REJECTED",
          entityType: "AccountJoinRequest",
          entityId: request.id,
          after: { email: request.email, accountId: request.accountId },
        });
        res.json({ ok: true, status: "REJECTED" });
        return;
      }

      const inviteLink = request.inviteLinkId
        ? await prisma.accountInviteLink.findUnique({
            where: { id: request.inviteLinkId },
            select: { roleMode: true, role: true, orgRole: true },
          })
        : null;

      let role: AccountRole;
      let orgRole: Role;
      if (inviteLink?.roleMode === InviteRoleMode.FIXED) {
        role = inviteLink.role;
        orgRole = inviteLink.orgRole;
      } else {
        role =
          body.role && Object.values(AccountRole).includes(body.role as AccountRole)
            ? (body.role as AccountRole)
            : AccountRole.USER;
        orgRole =
          body.org_role && Object.values(Role).includes(body.org_role as Role)
            ? (body.org_role as Role)
            : accountRoleToOrgRole(role);
        if (!canAssignAccountRole(actor, role) || !canAssignOrgRole(actor, orgRole)) {
          throw httpError(403, "Você só pode conceder papéis abaixo do seu.");
        }
      }

      await prisma.$transaction(async (tx) => {
        const existingUser = await tx.user.findFirst({
          where: { email: request.email },
          select: { id: true },
        });
        if (existingUser) {
          throw httpError(409, "Já existe um usuário com este e-mail.");
        }

        if (!request.isExternal && request.registration) {
          const taken = await tx.employeeProfile.findFirst({
            where: {
              organizationId: request.account.organizationId,
              registration: request.registration,
            },
            select: { id: true },
          });
          if (taken) {
            throw httpError(
              409,
              "Este número de cadastro já está em uso nesta empresa.",
            );
          }
        }

        const loginBase =
          !request.isExternal && request.registration
            ? request.registration.toLowerCase().replace(/[^a-z0-9._-]/g, "") ||
              loginCandidateFromEmail(request.email)
            : loginCandidateFromEmail(request.email);
        const login = await allocateUniqueLogin(loginBase, tx);

        const user = await tx.user.create({
          data: {
            login,
            email: request.email,
            name: request.name,
            passwordHash: request.passwordHash,
            mustChangePassword: false,
          },
        });

        await tx.accountMembership.create({
          data: {
            accountId: request.accountId,
            userId: user.id,
            role,
          },
        });

        await tx.membership.create({
          data: {
            userId: user.id,
            organizationId: request.account.organizationId,
            role: orgRole,
          },
        });

        await tx.employeeProfile.create({
          data: {
            organizationId: request.account.organizationId,
            userId: user.id,
            registration: request.isExternal ? null : request.registration,
          },
        });

        await tx.accountJoinRequest.update({
          where: { id: request.id },
          data: {
            status: "APPROVED",
            decidedRole: role,
            decidedOrgRole: orgRole,
            decidedById: actor.userId,
            decidedAt: new Date(),
            decisionNote: blank(body.note),
            passwordHash: "",
          },
        });
      });

      await writeAudit({
        organizationId: actor.organizationId,
        actorId: actor.userId,
        action: "ACCOUNT_JOIN_APPROVED",
        entityType: "AccountJoinRequest",
        entityId: request.id,
        after: {
          email: request.email,
          accountId: request.accountId,
          role,
          orgRole,
        },
      });

      res.json({ ok: true, status: "APPROVED", role, org_role: orgRole });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new AccountInviteController();
