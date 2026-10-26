import prisma from "../model/prisma";
import { canReadModule } from "./module-access";
import { effectivePermission } from "./auth";
import { accessEnded } from "./access-period";
import type { AuthRequest } from "../types/auth";
import type { Response, NextFunction, Request } from "express";

/**
 * Quem é o comitê de ética desta empresa.
 *
 * Antes era "quem tem leitura no módulo comite" — na prática, o RH inteiro,
 * e uma denúncia contra alguém do RH ia parar na mesa dele. Agora a empresa
 * designa.
 *
 * Enquanto não houver ninguém designado, vale a regra antiga: ligar a
 * funcionalidade não pode trancar a empresa fora das próprias denúncias.
 * [CB-27]
 */
export async function isEthicsCommittee(
  organizationId: string,
  userId: string,
  permission: string,
): Promise<boolean> {
  const designados = await prisma.ethicsCommitteeMember.count({
    where: { organizationId },
  });
  if (designados === 0) return canReadModule(permission, "comite");

  const souDoComite = await prisma.ethicsCommitteeMember.findFirst({
    where: { organizationId, userId },
    select: { userId: true },
  });
  return Boolean(souDoComite);
}

/**
 * Quem recebe uma denúncia nova: o comitê designado, ou — enquanto não
 * houver ninguém designado — quem lê o módulo comite, a mesma regra de
 * `isEthicsCommittee`. [CB-29]
 */
export async function usersInEthicsCommittee(
  organizationId: string,
): Promise<string[]> {
  const designados = await prisma.ethicsCommitteeMember.findMany({
    where: { organizationId },
    select: { userId: true },
  });
  if (designados.length > 0) return designados.map((m) => m.userId);

  const membros = await prisma.membership.findMany({
    where: { organizationId, suspendedAt: null, user: { active: true } },
    select: { userId: true, role: true, accessExpiresAt: true },
  });
  return membros
    .filter(
      (m) =>
        !accessEnded(m.accessExpiresAt) &&
        canReadModule(effectivePermission(m.role), "comite"),
    )
    .map((m) => m.userId);
}

/** As denúncias em que a pessoa é citada — e das quais está fora. [CB-27] */
export async function citedReportIds(userId: string): Promise<string[]> {
  const rows = await prisma.ethicsReportCited.findMany({
    where: { userId },
    select: { reportId: true },
  });
  return rows.map((r) => r.reportId);
}

export async function requireEthicsCommittee(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const actor = (req as AuthRequest).actor;
  if (!actor) {
    res.status(401).json({ message: "Não autenticado." });
    return;
  }
  const doComite = await isEthicsCommittee(
    actor.organizationId,
    actor.userId,
    actor.permission,
  );
  if (doComite) {
    next();
    return;
  }
  /*
    Dizer onde se decide: quem administra a conta pode ter designado o comitê
    sem se incluir, e a mensagem seca não leva a lugar nenhum. [CB-27]
  */
  res.status(403).json({
    message:
      "Acesso restrito a quem foi designado para o comitê de ética. " +
      "Quem é do comitê se define em Conta → Comitê de ética.",
  });
}
