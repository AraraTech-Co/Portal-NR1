import { AccountRole, Role } from "@prisma/client";
import prisma from "../model/prisma";
import { Account } from "../model/schema/Account/Account";
import { AccountMembership } from "../model/schema/AccountMembership/AccountMembership";
import { Membership } from "../model/schema/Membership/Membership";
import { isOrgMaster } from "./auth";
import type { AccessibleAccount } from "../types/auth";

/**
 * Contas que o usuário pode usar na sessão:
 * - todas em que é membro (AccountMembership)
 * - mais todas as contas das empresas onde é MASTER
 */
export async function listAccessibleAccounts(
  userId: string,
): Promise<AccessibleAccount[]> {
  const accountMemberships = new AccountMembership();
  const memberships = new Membership();
  const accounts = new Account();

  const byId = new Map<string, AccessibleAccount>();

  const links = await accountMemberships.custom.read.byUser(userId);
  for (const link of links) {
    if (!link.account.active || !link.account.organization.active) continue;
    byId.set(link.accountId, {
      id: link.accountId,
      name: link.account.name,
      account_role: link.role,
      via_master: false,
      organization: {
        id: link.account.organizationId,
        name: link.account.organization.name,
      },
    });
  }

  const orgLinks = await memberships.custom.read.byUser(userId);
  for (const org of orgLinks) {
    if (!isOrgMaster(org.role) || !org.organization.active) continue;
    const orgAccounts = await accounts.custom.read.activeByOrganization(
      org.organizationId,
    );
    for (const acc of orgAccounts) {
      if (!acc.organization.active) continue;
      const existing = byId.get(acc.id);
      if (existing) {
        existing.via_master = true;
        continue;
      }
      byId.set(acc.id, {
        id: acc.id,
        name: acc.name,
        account_role: null,
        via_master: true,
        organization: {
          id: acc.organizationId,
          name: acc.organization.name,
        },
      });
    }
  }

  return Array.from(byId.values());
}

export type ResolvedAccountAccess = {
  organizationId: string;
  organizationName: string;
  accountId: string;
  accountName: string;
  accountRole: AccountRole | null;
  orgRole: Role;
  grants: string[];
  isMaster: boolean;
  user: {
    id: string;
    login: string;
    email: string | null;
    name: string;
    active: boolean;
    mustChangePassword: boolean;
  };
};

/**
 * Resolve se o usuário pode atuar na conta:
 * MASTER da empresa da conta → sim (todas as contas)
 * senão → precisa de AccountMembership
 */
export async function resolveAccountAccess(
  userId: string,
  accountId: string,
): Promise<ResolvedAccountAccess | null> {
  const accounts = new Account();
  const account = await accounts.custom.read.withOrg(accountId);
  if (!account || !account.active || !account.organization.active) {
    return null;
  }

  const memberships = new Membership();
  const orgMembership = await memberships.custom.read.withOrg({
    userId,
    organizationId: account.organizationId,
  });

  const accountMemberships = new AccountMembership();
  const link = await accountMemberships.custom.read.withAccount({
    userId,
    accountId,
  });

  const master = isOrgMaster(orgMembership?.role);
  if (!master && !link) return null;
  if (link && !link.user.active) return null;

  // MASTER sem membership na conta: carrega o user direto
  let user = link?.user;
  if (!user) {
    const row = await prisma.user.findFirst({
      where: { id: userId, active: true },
      select: {
        id: true,
        login: true,
        email: true,
        name: true,
        active: true,
        mustChangePassword: true,
      },
    });
    if (!row) return null;
    user = row;
  }

  return {
    organizationId: account.organizationId,
    organizationName: account.organization.name,
    accountId: account.id,
    accountName: account.name,
    accountRole: link?.role ?? null,
    orgRole: orgMembership?.role ?? Role.COLABORADOR,
    grants: orgMembership?.grants ?? [],
    isMaster: master,
    user,
  };
}
