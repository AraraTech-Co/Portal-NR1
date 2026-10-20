import prisma from "../model/prisma";

/**
 * O que o fiscal abriu, legível.
 *
 * Cada tela do portal dispara várias consultas — o sino, a lista de
 * unidades, a lista de pessoas —, e a trilha guardava uma linha para cada
 * uma: 147 linhas numa sessão, 35 delas como "Outra consulta", com o
 * endereço interno embaixo. A pergunta "o que o fiscal viu" tem de caber
 * numa olhada. [B2-4-H]
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

type Tela = {
  /** Nome da tela, como quem lê conhece. */
  screen: string;
  /** Quando a consulta abre um registro, de que tipo ele é. */
  entity?:
    | "risk"
    | "hazard"
    | "action"
    | "occurrence"
    | "service_order"
    | "pgr_document"
    | "employee"
    | "hr_document"
    | "training"
    | "aep";
};

/**
 * Consultas que a tela faz sozinha, para montar filtro ou contar aviso.
 * Não são "o fiscal abriu tal coisa", e por padrão não entram na lista.
 */
const AUXILIARES = [
  "/api/notificacoes",
  "/api/auth",
  "/api/modules",
  "/api/establishments",
  "/api/sectors",
  "/api/job-roles",
  "/api/activities",
  "/api/methodologies",
  "/api/psychosocial-factors",
  "/api/organization",
  "/api/org-members",
];

/** Prefixo da rota → tela. A ordem importa: o mais específico primeiro. */
const TELAS: [RegExp, Tela][] = [
  [/^\/api\/inicio/, { screen: "Início" }],
  [/^\/api\/fiscalizacao\/historico/, { screen: "Painel da fiscalização — histórico" }],
  [/^\/api\/fiscalizacao/, { screen: "Painel da fiscalização" }],
  [/^\/api\/pgr-documents\/(?<id>[^/?]+)/, { screen: "Documento do PGR", entity: "pgr_document" }],
  [/^\/api\/pgr-documents/, { screen: "Documentos do PGR" }],
  [/^\/api\/inventory/, { screen: "Inventário de riscos" }],
  [/^\/api\/risks\/(?<id>[^/?]+)/, { screen: "Inventário — um risco", entity: "risk" }],
  [/^\/api\/hazards\/(?<id>[^/?]+)/, { screen: "Inventário — um perigo", entity: "hazard" }],
  [/^\/api\/(risks|hazards|assessments|controls)/, { screen: "Inventário de riscos" }],
  [/^\/api\/actions\/(?<id>[^/?]+)/, { screen: "Plano de ação — uma ação", entity: "action" }],
  [/^\/api\/actions/, { screen: "Plano de ação" }],
  [/^\/api\/evidences/, { screen: "Evidência de ação" }],
  [/^\/api\/occurrences\/(?<id>[^/?]+)/, { screen: "Ocorrência", entity: "occurrence" }],
  [/^\/api\/occurrences/, { screen: "Ocorrências" }],
  [/^\/api\/service-orders\/(?<id>[^/?]+)/, { screen: "Ordem de serviço", entity: "service_order" }],
  [/^\/api\/service-orders/, { screen: "Ordens de serviço" }],
  [/^\/api\/aeps\/(?<id>[^/?]+)/, { screen: "Avaliação ergonômica", entity: "aep" }],
  [/^\/api\/(aeps|preliminary-surveys)/, { screen: "Avaliação ergonômica" }],
  [/^\/api\/queixas-ergonomicas/, { screen: "Queixas ergonômicas" }],
  [/^\/api\/emergency-procedures/, { screen: "Emergências" }],
  [/^\/api\/contractors/, { screen: "Terceiros" }],
  [/^\/api\/participations/, { screen: "Participação" }],
  [/^\/api\/trainings\/(?<id>[^/?]+)/, { screen: "Treinamento", entity: "training" }],
  [/^\/api\/trainings/, { screen: "Treinamentos" }],
  [/^\/api\/(occupational-exams|worker-certificates|job-role-requirements)/, { screen: "Saúde e exigências" }],
  [/^\/api\/hr-documents\/(?<id>[^/?]+)/, { screen: "Documento do RH", entity: "hr_document" }],
  [/^\/api\/hr-documents/, { screen: "Documentos do RH" }],
  [/^\/api\/summons/, { screen: "Convocações" }],
  [/^\/api\/employee-profiles\/(?<id>[^/?]+)/, { screen: "Ficha de colaborador", entity: "employee" }],
  [/^\/api\/employee-profiles/, { screen: "Colaboradores" }],
];

/** Os três documentos do PGR, com o nome que a tela usa. */
const PGR_LABEL: Record<string, string> = {
  INVENTORY: "Inventário de riscos",
  ACTION_PLAN: "Plano de ação",
  CRITERIA: "Critérios do GRO",
  AEP: "Avaliação ergonômica",
};

export type Consulta = {
  screen: string;
  entity: Tela["entity"] | null;
  entityId: string | null;
  path: string;
  auxiliary: boolean;
};

export function lerCaminho(raw: string | null): Consulta {
  const path = (raw ?? "").split("?")[0] ?? "";
  if (AUXILIARES.some((a) => path.startsWith(a))) {
    return { screen: "Consulta de apoio da tela", entity: null, entityId: null, path, auxiliary: true };
  }
  for (const [regex, tela] of TELAS) {
    const m = path.match(regex);
    if (!m) continue;
    const id = m.groups?.id;
    const ehUuid = id ? new RegExp(`^${UUID}$`, "i").test(id) : false;
    return {
      screen: tela.screen,
      entity: ehUuid ? (tela.entity ?? null) : null,
      entityId: ehUuid ? id! : null,
      path,
      auxiliary: false,
    };
  }
  return { screen: "Outra consulta", entity: null, entityId: null, path, auxiliary: false };
}

/**
 * O nome do registro aberto — "Risco: Corte nas mãos", e não um
 * identificador. Uma consulta por tipo, com os ids da própria lista.
 */
export async function nomesDosRegistros(
  organizationId: string,
  consultas: Consulta[],
): Promise<Map<string, string>> {
  const porTipo = new Map<string, string[]>();
  for (const c of consultas) {
    if (!c.entity || !c.entityId) continue;
    porTipo.set(c.entity, [...(porTipo.get(c.entity) ?? []), c.entityId]);
  }
  const nomes = new Map<string, string>();
  const guardar = (id: string, nome: string | null | undefined) => {
    if (nome) nomes.set(id, nome);
  };

  for (const [tipo, ids] of porTipo) {
    const where = { id: { in: [...new Set(ids)] }, organizationId };
    if (tipo === "risk") {
      for (const r of await prisma.risk.findMany({ where, select: { id: true, description: true } })) {
        guardar(r.id, r.description);
      }
    } else if (tipo === "hazard") {
      for (const h of await prisma.hazard.findMany({ where, select: { id: true, description: true } })) {
        guardar(h.id, h.description);
      }
    } else if (tipo === "action") {
      for (const a of await prisma.action.findMany({ where, select: { id: true, title: true } })) {
        guardar(a.id, a.title);
      }
    } else if (tipo === "occurrence") {
      for (const o of await prisma.occurrence.findMany({ where, select: { id: true, description: true } })) {
        guardar(o.id, o.description.slice(0, 80));
      }
    } else if (tipo === "service_order") {
      for (const s of await prisma.serviceOrder.findMany({
        where,
        select: { id: true, version: true, jobRole: { select: { name: true } } },
      })) {
        guardar(s.id, `${s.jobRole.name} · v${s.version}`);
      }
    } else if (tipo === "pgr_document") {
      for (const d of await prisma.pgrDocument.findMany({
        where,
        select: { id: true, type: true, version: true },
      })) {
        guardar(d.id, `${PGR_LABEL[d.type] ?? d.type} · v${d.version}`);
      }
    } else if (tipo === "employee") {
      for (const p of await prisma.employeeProfile.findMany({
        where,
        select: { id: true, user: { select: { name: true } } },
      })) {
        guardar(p.id, p.user.name);
      }
    } else if (tipo === "hr_document") {
      for (const d of await prisma.hrDocument.findMany({ where, select: { id: true, title: true } })) {
        guardar(d.id, d.title);
      }
    } else if (tipo === "training") {
      for (const t of await prisma.training.findMany({ where, select: { id: true, title: true } })) {
        guardar(t.id, t.title);
      }
    } else if (tipo === "aep") {
      for (const a of await prisma.aep.findMany({ where, select: { id: true, scopeDescription: true } })) {
        guardar(a.id, a.scopeDescription);
      }
    }
  }
  return nomes;
}
