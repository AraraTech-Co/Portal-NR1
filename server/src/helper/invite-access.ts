import { Role } from "@prisma/client";
import prisma from "../model/prisma";
import { effectivePermission } from "./auth";
import { canWriteModule } from "./module-access";
import type { Actor } from "../types/auth";

/** Ordem: COLABORADOR < SUPERVISOR < ADM_LOJA < GERENTE < RH/SST < ADMIN < OWNER < MASTER */
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
  /// Dono de uma conta; abaixo de MASTER, que alcança todas. [OB-3]
  OWNER: 7,
  MASTER: 8,
};

export function canManageInviteLinks(actor: Actor): boolean {
  return canWriteModule(actor.permission, "conta");
}

/** Papéis que decidem pedidos da própria conta, sem cuidar de Conta. */
const DECIDEM_NA_CONTA: readonly Role[] = [
  Role.ADMIN,
  Role.RH,
  Role.SST,
  Role.GERENTE,
  Role.ADM_LOJA,
];

/**
 * Quem deve ser avisado de um pedido de entrada na conta: o mesmo recorte do
 * Início e da tela que decide. Quem cuida de Conta (e o master) decide os de
 * todas as contas da empresa; os outros papéis que decidem, só os da conta
 * de que fazem parte. Acesso suspenso ou vencido não recebe. [CB-29]
 */
export async function quemDecidePedidosDaConta(
  organizationId: string,
  accountId: string,
): Promise<string[]> {
  const agora = new Date();
  const membros = await prisma.membership.findMany({
    where: {
      organizationId,
      suspendedAt: null,
      OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: agora } }],
      user: { active: true },
    },
    select: {
      userId: true,
      role: true,
      user: { select: { accountMemberships: { where: { accountId }, select: { id: true } } } },
    },
  });
  return membros
    .filter((m) => {
      if (m.role === Role.MASTER || canWriteModule(effectivePermission(m.role), "conta")) {
        return true;
      }
      return DECIDEM_NA_CONTA.includes(m.role) && m.user.accountMemberships.length > 0;
    })
    .map((m) => m.userId);
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

export function assignableOrgRoles(actor: Actor): Role[] {
  const ceiling = ORG_RANK[actor.role] ?? ORG_RANK.COLABORADOR;
  const below = (Object.keys(ORG_RANK) as Role[]).filter(
    (r) =>
      ORG_RANK[r] < ceiling &&
      r !== Role.MASTER &&
      r !== Role.FISCAL &&
      // "Admin (legado)" sai da lista; quem já tem continua valendo como
      // gerente. Ninguém escolhe de propósito um papel chamado legado. [OB-2]
      r !== Role.ADMIN,
  );
  // Pela planilha de acessos, só Master e RH cuidam de Conta e usuários —
  // são eles que dão acesso a alguém de fora. [S7-A]
  if (canWriteModule(actor.permission, "conta")) below.push(Role.FISCAL);
  return below.length > 0 ? below : [Role.COLABORADOR];
}

export function canAssignOrgRole(actor: Actor, target: Role): boolean {
  return assignableOrgRoles(actor).includes(target);
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
