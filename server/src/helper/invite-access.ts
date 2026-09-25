import { AccountRole, Role } from "@prisma/client";
import { can } from "./permissions";
import type { Actor } from "../types/auth";

const ACCOUNT_RANK: Record<AccountRole, number> = {
  USER: 1,
  ADMIN: 2,
  OWNER: 3,
};

const ORG_RANK: Record<Role, number> = {
  COLABORADOR: 1,
  RH: 2,
  SST: 3,
  ADMIN: 4,
  MASTER: 5,
};

export function canManageInviteLinks(actor: Actor): boolean {
  return actor.isMaster || can(actor.permission, "admin");
}

/** Quem pode aprovar/recusar pedidos de entrada. */
export function canDecideJoinRequests(actor: Actor): boolean {
  if (actor.isMaster || can(actor.permission, "admin")) return true;
  return (
    actor.role === Role.ADMIN ||
    actor.role === Role.RH ||
    actor.role === Role.SST
  );
}

export function assignableAccountRoles(actor: Actor): AccountRole[] {
  if (actor.isMaster) {
    return [AccountRole.OWNER, AccountRole.ADMIN, AccountRole.USER];
  }
  const ceiling = actor.accountRole
    ? ACCOUNT_RANK[actor.accountRole]
    : ACCOUNT_RANK.USER;
  const below = (
    Object.keys(ACCOUNT_RANK) as AccountRole[]
  ).filter((r) => ACCOUNT_RANK[r] < ceiling);
  return below.length > 0 ? below : [AccountRole.USER];
}

export function assignableOrgRoles(actor: Actor): Role[] {
  const ceiling = ORG_RANK[actor.role] ?? ORG_RANK.COLABORADOR;
  const below = (Object.keys(ORG_RANK) as Role[]).filter(
    (r) => ORG_RANK[r] < ceiling && r !== Role.MASTER,
  );
  return below.length > 0 ? below : [Role.COLABORADOR];
}

export function canAssignAccountRole(actor: Actor, target: AccountRole): boolean {
  return assignableAccountRoles(actor).includes(target);
}

export function canAssignOrgRole(actor: Actor, target: Role): boolean {
  return assignableOrgRoles(actor).includes(target);
}

export function accountRoleToOrgRole(role: AccountRole): Role {
  switch (role) {
    case AccountRole.OWNER:
    case AccountRole.ADMIN:
      return Role.ADMIN;
    default:
      return Role.COLABORADOR;
  }
}

export function assertInviteLinkUsable(link: {
  active: boolean;
  expiresAt: Date | null;
  maxUses: number | null;
  usedCount: number;
}) {
  if (!link.active) {
    throw Object.assign(new Error("Este convite não está mais ativo."), {
      status: 400,
    });
  }
  if (link.expiresAt && link.expiresAt < new Date()) {
    throw Object.assign(new Error("Este convite expirou."), { status: 400 });
  }
  if (link.maxUses !== null && link.usedCount >= link.maxUses) {
    throw Object.assign(new Error("Este convite esgotou o número de usos."), {
      status: 400,
    });
  }
}
