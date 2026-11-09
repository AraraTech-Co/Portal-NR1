import type { Actor } from "../types/auth";
import prisma from "../model/prisma";

/**
 * Recorte por unidade. [C2-13]
 *
 * Gerente, supervisor e ADM loja respondem pelas unidades que Master, Dono ou
 * RH atribuíram expressamente (`ManagedEstablishment`); fora delas, não veem
 * nem mexem em registro de terceiros. Master, Dono e RH são a gestão central
 * (a empresa inteira). SST e fiscal ficam como estavam: a abrangência deles é
 * técnica e o recorte não lhes dá nem tira nada.
 *
 * Dois escopos, nunca somados:
 * - `managed`: as unidades geridas — dão as operações e a visão de gestor;
 * - `work`: a unidade de trabalho da própria pessoa — dá exatamente o que um
 *   colaborador teria (o coletivo destinado à unidade dele).
 * Somar os dois daria poder de gestor na loja onde a pessoa só trabalha.
 *
 * Resolvido a cada requisição: tirar a unidade corta o acesso na sessão
 * aberta, sem novo login.
 */

/** Papéis recortados por unidade. "Admin (legado)" vale como gerente (OB-2). */
const UNIT_SCOPED_PERMISSIONS: readonly string[] = ["gerente", "supervisor", "adm_loja"];

/** Gestão central: a empresa inteira. */
const CENTRAL_PERMISSIONS: readonly string[] = ["master", "owner", "rh"];

/**
 * Sem recorte por unidade: a central, e SST e fiscal, que ficam com a
 * abrangência técnica que já tinham. O colaborador NÃO está aqui: ele vê o
 * próprio e o coletivo da sua unidade de trabalho.
 */
const WHOLE_ORG_PERMISSIONS: readonly string[] = [...CENTRAL_PERMISSIONS, "sst", "fiscal"];

export function isUnitScoped(permission: string): boolean {
  return UNIT_SCOPED_PERMISSIONS.includes(permission);
}

export function isCentral(permission: string): boolean {
  return CENTRAL_PERMISSIONS.includes(permission);
}

export type UnitScope = {
  userId: string;
  organizationId: string;
  /**
   * Sem recorte: alcança a empresa inteira no que o módulo já lhe dava
   * (central, SST, fiscal). Os demais ficam no próprio + `managed` + `work`.
   */
  wholeOrg: boolean;
  /** Unidades geridas; vazio para quem não é recortado. */
  managed: string[];
  /** Recortado por unidade e sem nenhuma atribuída: aviso para regularizar. */
  needsUnits: boolean;
  /** Unidade de trabalho (ficha ativa → função → setor), se houver. */
  work: string | null;
};

/** Unidade de trabalho atual da pessoa: ficha ativa → função → setor → unidade ativa. */
export async function currentUnitOf(organizationId: string, userId: string): Promise<string | null> {
  const ficha = await prisma.employeeProfile.findFirst({
    where: { organizationId, userId, dismissedAt: null },
    select: {
      jobRole: {
        select: { sector: { select: { establishment: { select: { id: true, organizationId: true, archivedAt: true } } } } },
      },
    },
  });
  const unidade = ficha?.jobRole?.sector?.establishment;
  if (!unidade || unidade.organizationId !== organizationId || unidade.archivedAt) return null;
  return unidade.id;
}

/**
 * Unidades geridas pelo ator nesta empresa. Só contam enquanto o papel ATUAL
 * é recortado (linha que sobrou de um papel antigo não dá nada), e só
 * unidades ativas da mesma empresa.
 */
async function managedUnitsOf(actor: Pick<Actor, "userId" | "organizationId" | "permission">): Promise<string[]> {
  if (!isUnitScoped(actor.permission)) return [];
  const linhas = await prisma.managedEstablishment.findMany({
    where: {
      organizationId: actor.organizationId,
      membership: { userId: actor.userId, organizationId: actor.organizationId },
      establishment: { organizationId: actor.organizationId, archivedAt: null },
    },
    select: { establishmentId: true },
  });
  return [...new Set(linhas.map((l) => l.establishmentId))];
}

export async function unitScopeOf(
  actor: Pick<Actor, "userId" | "organizationId" | "permission">,
): Promise<UnitScope> {
  const recortado = isUnitScoped(actor.permission);
  const [managed, work] = await Promise.all([
    managedUnitsOf(actor),
    currentUnitOf(actor.organizationId, actor.userId),
  ]);
  return {
    userId: actor.userId,
    organizationId: actor.organizationId,
    wholeOrg: WHOLE_ORG_PERMISSIONS.includes(actor.permission),
    managed,
    needsUnits: recortado && managed.length === 0,
    work,
  };
}

/**
 * Filtro de registro individual (holerite, férias, ponto, atestado, doc. RH
 * pessoal, exame, certificado) para quem vê o de terceiros no módulo: a
 * empresa inteira para a central; para o recortado, o próprio e os gravados
 * com uma unidade gerida. Registro sem unidade fica com a central.
 */
export function personRecordScope(scope: UnitScope, ownerField = "userId"): Record<string, unknown> {
  if (scope.wholeOrg) return {};
  return {
    OR: [
      { [ownerField]: scope.userId },
      ...(scope.managed.length ? [{ establishmentId: { in: scope.managed } }] : []),
    ],
  };
}

/** O registro individual está no escopo de gestão do ator (sem contar o próprio). */
export function managesPersonRecord(scope: UnitScope, record: { establishmentId: string | null }): boolean {
  if (scope.wholeOrg) return true;
  return record.establishmentId !== null && scope.managed.includes(record.establishmentId);
}

/** A pessoa (pela unidade de trabalho atual) está sob a gestão do ator. Para criar registro para ela. */
export async function managesPerson(scope: UnitScope, userId: string): Promise<boolean> {
  if (scope.wholeOrg) return true;
  if (!scope.managed.length) return false;
  const unidade = await currentUnitOf(scope.organizationId, userId);
  return unidade !== null && scope.managed.includes(unidade);
}

/**
 * Filtro Prisma para o quadro de pessoas (fichas) visível ao recortado: a
 * própria ficha e as fichas cuja unidade de trabalho atual é gerida.
 */
export function profileScope(scope: UnitScope): Record<string, unknown> {
  if (scope.wholeOrg) return {};
  return {
    OR: [
      { userId: scope.userId },
      ...(scope.managed.length
        ? [{ jobRole: { sector: { establishmentId: { in: scope.managed } } } }]
        : []),
    ],
  };
}

/** Resposta única para "não existe" e "fora do seu escopo" — não revela qual dos dois. */
export const NOT_FOUND_BODY = { message: "Registro não encontrado." } as const;

/**
 * Registro coletivo com unidade (ocorrência, AEP, participação, emergência):
 * como o ator o vê. `manager` = unidade gerida (operações e visão de gestor);
 * `worker` = a unidade de trabalho dele (o que um colaborador teria);
 * `none` = fora. Sem unidade no registro, só quem não é recortado.
 */
export type CollectiveView = "whole" | "manager" | "worker" | "none";

export function collectiveView(scope: UnitScope, establishmentId: string | null): CollectiveView {
  if (scope.wholeOrg) return "whole";
  if (establishmentId === null) return "none";
  if (scope.managed.includes(establishmentId)) return "manager";
  if (scope.work === establishmentId) return "worker";
  return "none";
}

/**
 * Filtro Prisma de leitura do coletivo: tudo para quem não é recortado; para
 * os demais, unidades geridas e a de trabalho, mais o que a própria pessoa
 * registrou (`ownerField`, se o modelo tiver).
 */
export function collectiveReadScope(scope: UnitScope, ownerField?: string): Record<string, unknown> {
  if (scope.wholeOrg) return {};
  const unidades = [...scope.managed, ...(scope.work ? [scope.work] : [])];
  const ou: Record<string, unknown>[] = [];
  if (unidades.length) ou.push({ establishmentId: { in: unidades } });
  if (ownerField) ou.push({ [ownerField]: scope.userId });
  return ou.length ? { OR: ou } : { id: { in: [] } };
}

/** Filtro Prisma das unidades em que o ator age como gestor (escrita de gestor). */
export function managedUnitFilter(scope: UnitScope): Record<string, unknown> {
  if (scope.wholeOrg) return {};
  return { establishmentId: { in: scope.managed } };
}


/** O recorte de quem fez a requisição (já autenticada). */
export async function scopeOfRequest(req: { actor?: Pick<Actor, "userId" | "organizationId" | "permission"> }): Promise<UnitScope> {
  if (!req.actor) throw Object.assign(new Error("Não autenticado."), { status: 401 });
  return unitScopeOf(req.actor);
}
