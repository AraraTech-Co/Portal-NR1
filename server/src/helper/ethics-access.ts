import { Role } from "@prisma/client";
import prisma from "../model/prisma";
import { canReadModule } from "./module-access";
import { effectivePermission } from "./auth";
import { accessEnded } from "./access-period";
import type { Actor, AuthRequest } from "../types/auth";
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

/**
 * Quem faz a triagem da denúncia que diz envolver o comitê: o dono e o
 * master.
 *
 * Pela decisão B3-3-H, o canal pergunta "alguém do comitê está envolvido?"
 * sem mostrar nomes. Quando a resposta é sim, o caso não chega ao comitê —
 * fica com estes, que conferem quem a denúncia envolve e devolvem o caso.
 * [B3-3-H]
 */
export function podeTriarDenuncia(actor: Actor): boolean {
  return Boolean(actor.isMaster) || actor.role === Role.OWNER;
}

/** As mesmas pessoas, para avisar. [B3-3-H] */
export async function usersWhoTriageReports(
  organizationId: string,
): Promise<string[]> {
  const membros = await prisma.membership.findMany({
    where: {
      organizationId,
      role: { in: [Role.OWNER, Role.MASTER] },
      suspendedAt: null,
      user: { active: true },
    },
    select: { userId: true },
  });
  return membros.map((m) => m.userId);
}

/**
 * As denúncias que ainda estão na triagem — fora do alcance do comitê, em
 * qualquer tela: lista, endereço direto e contagem do Início. [B3-3-H]
 */
export async function reportsAwaitingTriage(
  organizationId: string,
): Promise<string[]> {
  const rows = await prisma.ethicsReport.findMany({
    where: { organizationId, committeeInvolved: true, triagedAt: null },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * O recorte das denúncias para quem está olhando, como filtro de consulta.
 *
 * São três situações, e a lista, o endereço direto e a contagem do Início
 * precisam concordar — era o número do Início revelando a existência de um
 * caso que a pessoa não pode abrir [CB-68]:
 *
 * - quem é do comitê e tria (dono, master designado): vê tudo, menos o que
 *   o cita;
 * - quem é do comitê e não tria: vê o mesmo, menos o que ainda está na
 *   triagem [B3-3-H];
 * - quem tria e não é do comitê: vê só o que está na triagem — é o que a
 *   decisão lhe deu, e nada além.
 */
export async function ethicsReportScope(
  organizationId: string,
  actor: Actor,
): Promise<Record<string, unknown>> {
  const [doComite, citadas] = await Promise.all([
    isEthicsCommittee(organizationId, actor.userId, actor.permission),
    citedReportIds(actor.userId),
  ]);
  const tria = podeTriarDenuncia(actor);
  const forteDeCitadas = citadas.length > 0 ? { id: { notIn: citadas } } : {};

  if (!doComite) {
    /* Só tria: o alcance é a triagem, nunca o acervo do comitê. */
    const naTriagem = (await reportsAwaitingTriage(organizationId)).filter(
      (id) => !citadas.includes(id),
    );
    return { id: { in: naTriagem } };
  }
  if (tria) return forteDeCitadas;

  const naTriagem = await reportsAwaitingTriage(organizationId);
  const fora = [...new Set([...citadas, ...naTriagem])];
  return fora.length > 0 ? { id: { notIn: fora } } : {};
}

/** A denúncia está fora do alcance de quem abriu? [CB-27] [B3-3-H] */
export async function reportIsHidden(
  organizationId: string,
  actor: Actor,
  reportId: string,
): Promise<boolean> {
  const scope = await ethicsReportScope(organizationId, actor);
  /*
    `AND`, e não espalhar: o recorte também fala em `id`, e espalhá-lo por
    cima apagaria o id procurado — a consulta achava outra denúncia e dizia
    que esta estava liberada.
  */
  const achou = await prisma.ethicsReport.findFirst({
    where: { AND: [{ id: reportId, organizationId }, scope] },
    select: { id: true },
  });
  return achou === null;
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
  /* Quem tria precisa abrir o caso para conferir quem ele envolve. [B3-3-H] */
  const doComite =
    podeTriarDenuncia(actor) ||
    (await isEthicsCommittee(
      actor.organizationId,
      actor.userId,
      actor.permission,
    ));
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
