import prisma from "../model/prisma";
import { effectivePermission } from "./auth";
import { canHandleErgonomicComplaint } from "./module-access";
import { accessEnded } from "./access-period";

/**
 * Quem responde pelas queixas ergonômicas nesta empresa — para o portal
 * avisar sozinho.
 *
 * Quem está suspenso, com o prazo vencido ou desativado não é avisado: o
 * aviso iria para uma caixa que ninguém abre. [P1]
 */
export async function usersWhoHandleErgonomicComplaints(
  organizationId: string,
  now = new Date(),
): Promise<string[]> {
  const membros = await prisma.membership.findMany({
    where: { organizationId, suspendedAt: null, user: { active: true } },
    select: { userId: true, role: true, accessExpiresAt: true },
  });
  return membros
    .filter(
      (m) =>
        !accessEnded(m.accessExpiresAt, now) &&
        canHandleErgonomicComplaint(effectivePermission(m.role)),
    )
    .map((m) => m.userId);
}
