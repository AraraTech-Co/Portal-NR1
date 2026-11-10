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
  /** Unidade de trabalho (a filial da ficha ativa), se houver. [C3-2] */
  work: string | null;
};

/**
 * Unidade de trabalho atual da pessoa: a filial da ficha ativa, se ativa.
 * Com função, a filial é a da função (o banco garante); sem função, a que o
 * RH escolheu. [C3-2]
 */
export async function currentUnitOf(organizationId: string, userId: string): Promise<string | null> {
  const ficha = await prisma.employeeProfile.findFirst({
    where: { organizationId, userId, dismissedAt: null },
    select: { establishment: { select: { id: true, organizationId: true, archivedAt: true } } },
  });
  const unidade = ficha?.establishment;
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
 * própria ficha e as fichas cuja filial é gerida. [C3-2]
 */
export function profileScope(scope: UnitScope): Record<string, unknown> {
  if (scope.wholeOrg) return {};
  return {
    OR: [
      { userId: scope.userId },
      ...(scope.managed.length
        ? [{ establishmentId: { in: scope.managed } }]
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

/**
 * Unidades cujo coletivo o ator vê: as geridas e a de trabalho. `null` é
 * sem recorte (a empresa inteira); lista vazia é nenhuma.
 */
export function visibleUnits(scope: UnitScope): string[] | null {
  if (scope.wholeOrg) return null;
  return [...new Set([...scope.managed, ...(scope.work ? [scope.work] : [])])];
}

/** Filtro Prisma das unidades em que o ator age como gestor (escrita de gestor). */
export function managedUnitFilter(scope: UnitScope): Record<string, unknown> {
  if (scope.wholeOrg) return {};
  return { establishmentId: { in: scope.managed } };
}

/**
 * Age como gestor sobre o registro coletivo desta unidade: sem recorte, ou
 * unidade gerida. A unidade de trabalho NÃO entra: ali a pessoa tem o que o
 * colaborador teria.
 */
export function managesCollective(scope: UnitScope, establishmentId: string | null): boolean {
  const visao = collectiveView(scope, establishmentId);
  return visao === "whole" || visao === "manager";
}

/** Vê o registro coletivo: no escopo (gerida ou de trabalho), ou é o próprio. */
export function seesCollective(
  scope: UnitScope,
  establishmentId: string | null,
  ownerId?: string | null,
): boolean {
  if (ownerId && ownerId === scope.userId) return true;
  return collectiveView(scope, establishmentId) !== "none";
}

/**
 * Unidade da ação do plano: a do risco (perigo → atividade); sem risco, a da
 * ocorrência; sem as duas, a da mudança. Sem nenhuma, é da central.
 */
export const ACTION_UNIT_SELECT = {
  riskId: true,
  assigneeId: true,
  createdById: true,
  risk: { select: { hazard: { select: { activity: { select: { establishmentId: true } } } } } },
  occurrence: { select: { establishmentId: true } },
  changeEvent: { select: { establishmentId: true } },
} as const;

type ActionUnitRow = {
  risk: { hazard: { activity: { establishmentId: string } } } | null;
  occurrence: { establishmentId: string | null } | null;
  changeEvent: { establishmentId: string | null } | null;
};

export function actionUnitOf(action: ActionUnitRow): string | null {
  if (action.risk) return action.risk.hazard.activity.establishmentId;
  if (action.occurrence?.establishmentId) return action.occurrence.establishmentId;
  return action.changeEvent?.establishmentId ?? null;
}

/** Filtro Prisma das ações destas unidades, na mesma precedência de `actionUnitOf`. */
export function actionInUnits(unidades: string[]): Record<string, unknown> {
  const em = { in: unidades };
  return {
    OR: [
      { risk: { hazard: { activity: { establishmentId: em } } } },
      { riskId: null, occurrence: { establishmentId: em } },
      {
        riskId: null,
        OR: [{ occurrenceId: null }, { occurrence: { establishmentId: null } }],
        changeEvent: { establishmentId: em },
      },
    ],
  };
}

/** Quem executa a ação: o responsável; sem ele, quem abriu. Vê e executa a sua sempre. */
export function executesAction(scope: UnitScope, action: { assigneeId: string | null; createdById: string }): boolean {
  return (action.assigneeId || action.createdById) === scope.userId;
}

/** Leitura do plano de ação: o escopo coletivo e as ações que a pessoa executa. */
export function actionReadScope(scope: UnitScope): Record<string, unknown> {
  if (scope.wholeOrg) return {};
  const unidades = [...scope.managed, ...(scope.work ? [scope.work] : [])];
  return {
    OR: [
      { assigneeId: scope.userId },
      /* Quem abriu a ação continua a vê-la, mesmo sem unidade. */
      { createdById: scope.userId },
      ...(unidades.length ? [actionInUnits(unidades)] : []),
    ],
  };
}

/** Ações em que o ator age como gestor (contagens de gestão do Início). */
export function actionManagerScope(scope: UnitScope): Record<string, unknown> {
  if (scope.wholeOrg) return {};
  return actionInUnits(scope.managed);
}

/** O ator vê a ação: no escopo coletivo, executa ou a abriu. */
export function seesAction(scope: UnitScope, action: ActionUnitRow & { assigneeId: string | null; createdById: string }): boolean {
  return (
    executesAction(scope, action) ||
    action.createdById === scope.userId ||
    collectiveView(scope, actionUnitOf(action)) !== "none"
  );
}

/**
 * Pessoas que o ator pode indicar (responsável por ação ou por plano de
 * emergência): membros ativos da empresa; para quem tem recorte, ele mesmo e
 * quem trabalha nas unidades geridas — o mesmo alcance de `/api/org-members`.
 * Verdadeiro só se TODAS estiverem no alcance.
 */
export async function peopleInScope(scope: UnitScope, userIds: string[]): Promise<boolean> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return true;
  const alcance = scope.wholeOrg
    ? {}
    : {
        OR: [
          { userId: scope.userId },
          {
            user: {
              employeeProfiles: {
                some: { organizationId: scope.organizationId, dismissedAt: null, ...profileScope(scope) },
              },
            },
          },
        ],
      };
  const encontrados = await prisma.membership.count({
    where: {
      organizationId: scope.organizationId,
      userId: { in: ids },
      suspendedAt: null,
      user: { active: true },
      ...alcance,
    },
  });
  return encontrados === ids.length;
}


/** O recorte de quem fez a requisição (já autenticada). */
export async function scopeOfRequest(req: { actor?: Pick<Actor, "userId" | "organizationId" | "permission"> }): Promise<UnitScope> {
  if (!req.actor) throw Object.assign(new Error("Não autenticado."), { status: 401 });
  return unitScopeOf(req.actor);
}
