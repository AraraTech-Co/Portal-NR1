import { AccountRole, Role } from "@prisma/client";
import { canWriteModule } from "./module-access";
import type { Actor } from "../types/auth";

const ACCOUNT_RANK: Record<AccountRole, number> = {
  USER: 1,
  ADMIN: 2,
  OWNER: 3,
};

/** Ordem: COLABORADOR < SUPERVISOR < ADM_LOJA < GERENTE < RH/SST < ADMIN < MASTER */
const ORG_RANK: Record<Role, number> = {
  COLABORADOR: 1,
  /** Fora da hierarquia: quem atribui é quem cuida de Conta e usuários. */
  FISCAL: 1,
  SUPERVISOR: 2,
  ADM_LOJA: 3,
  GERENTE: 4,
  RH: 5,
  SST: 5,
  ADMIN: 6,
  MASTER: 7,
};

export function canManageInviteLinks(actor: Actor): boolean {
  return canWriteModule(actor.permission, "conta");
}

/** Quem pode aprovar/recusar pedidos de entrada. */
export function canDecideJoinRequests(actor: Actor): boolean {
  if (canWriteModule(actor.permission, "conta")) return true;
  return (
    actor.role === Role.ADMIN ||
    actor.role === Role.RH ||
    actor.role === Role.SST ||
    actor.role === Role.GERENTE ||
    actor.role === Role.ADM_LOJA
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
    (r) => ORG_RANK[r] < ceiling && r !== Role.MASTER && r !== Role.FISCAL,
  );
  // Pela planilha de acessos, só Master e RH cuidam de Conta e usuários —
  // são eles que dão acesso a alguém de fora. [S7-A]
  if (canWriteModule(actor.permission, "conta")) below.push(Role.FISCAL);
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
      return Role.ADMIN;
    case AccountRole.ADMIN:
      return Role.ADM_LOJA;
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
