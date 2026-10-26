import prisma from "../model/prisma";
import { effectivePermission } from "./auth";
import { canHandleErgonomicComplaint, canValidateAction } from "./module-access";
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

/**
 * Quem pode validar a ação do plano nesta empresa.
 *
 * O aviso de ação concluída ia para quem ABRIU a ação. Desde a revisão do
 * OB-6, quem abre pode não poder validar — e aí o aviso chegava a alguém que
 * não tem o que fazer com ele, enquanto quem valida não era avisado. [CB-56]
 */
export async function usersWhoValidateActions(
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
        canValidateAction(effectivePermission(m.role)),
    )
    .map((m) => m.userId);
}
