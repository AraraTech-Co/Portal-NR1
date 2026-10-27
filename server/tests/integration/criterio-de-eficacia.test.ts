import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import {
  CRITERIO_LABEL,
  podeEditarCriterio,
} from "../../../client/src/lib/labels";

/**
 * O critério de eficácia é exigido ao abrir a ação, editável até a
 * validação, e registrável depois na ação validada sem ele.
 *
 * Decisão B3-4-A: o campo passa a ser exigido junto com responsável e
 * prazo; fica editável até a validação; a ação já validada sem critério pode
 * recebê-lo depois, com autor e data, e o Painel deixa de cobrar. O campo
 * tem um nome só em todas as telas. (NR-1 1.5.5.2.2, aferição de
 * resultados.) [B3-4-A]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
const CLIENTE = join(__dirname, "..", "..", "..", "client", "src");

type Sessao = { token: string; user: { id: string } };
let app: Express;
let sst: Sessao;
let supervisor: Sessao;
let colaborador: Sessao;
const acoes: string[] = [];
const ocorrencias: string[] = [];

const as = (s: Sessao) => ({ Authorization: `Bearer ${s.token}` });

async function entrar(login: string): Promise<Sessao> {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as Sessao;
}

function emDias(dias: number): string {
  return new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);
}

/** Ação gravada direto, no estado que o caso precisa — como as de antes da regra. */
async function acaoNoEstado(
  titulo: string,
  status: "OPEN" | "WAITING_VALIDATION" | "VALIDATED" | "CANCELLED",
  criterio: string | null,
) {
  const a = await prisma.action.create({
    data: {
      organizationId: ORG_ID,
      title: `${titulo} ${SUFIXO}`,
      status,
      priority: "HIGH",
      assigneeId: colaborador.user.id,
      dueDate: new Date(`${emDias(30)}T00:00:00.000Z`),
      effectivenessCriteria: criterio,
      createdById: sst.user.id,
      ...(status === "VALIDATED"
        ? { validatedById: sst.user.id, validatedAt: new Date() }
        : {}),
    },
  });
  acoes.push(a.id);
  return a.id;
}

const patch = (s: Sessao, id: string, criterio: unknown) =>
  request(app)
    .patch(`/api/actions/${id}/criterio`)
    .set(as(s))
    .send({ effectiveness_criteria: criterio });

/** O mesmo formato de `rotulos-de-auditoria.test.ts`: bloco, depois linha. */
function semComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const fonte = (...c: string[]) =>
  semComentarios(readFileSync(join(CLIENTE, ...c), "utf8"));
const plano = (t: string) => t.replace(/\s+/g, " ");

beforeAll(async () => {
  app = createApp();
  sst = await entrar("teste.sst");
  supervisor = await entrar("teste.supervisor");
  colaborador = await entrar("teste.colaborador");
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({
    where: { entityType: "Action", entityId: { in: acoes } },
  });
  await prisma.notification.deleteMany({ where: { entityId: { in: acoes } } });
  await prisma.action.deleteMany({ where: { id: { in: acoes } } });
  await prisma.occurrence.deleteMany({ where: { id: { in: ocorrencias } } });
});

describe("a ação não abre sem critério [B3-4-A]", () => {
  const base = () => ({
    title: `Proteção da placa ${SUFIXO}`,
    priority: "HIGH",
    assignee_id: colaborador.user.id,
    due_date: emDias(20),
  });

  it("pelo plano de ação: sem critério, ou só com espaço, é recusada", async () => {
    for (const criterio of [undefined, "", "   "]) {
      const res = await request(app)
        .post("/api/actions")
        .set(as(sst))
        .send({ ...base(), effectiveness_criteria: criterio });
      expect(res.status, `critério ${JSON.stringify(criterio)}`).toBe(400);
      expect(res.body.code).toBe("CRITERIA_REQUIRED");
    }
  });

  it("pelo plano de ação: com critério, abre e grava o critério limpo", async () => {
    const res = await request(app)
      .post("/api/actions")
      .set(as(sst))
      .send({ ...base(), effectiveness_criteria: "  Zero projeção em 60 dias  " });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    acoes.push(res.body.action.id);
    const gravada = await prisma.action.findUniqueOrThrow({
      where: { id: res.body.action.id },
      select: { effectivenessCriteria: true },
    });
    expect(gravada.effectivenessCriteria).toBe("Zero projeção em 60 dias");
  });

  it("pela ocorrência: o mesmo", async () => {
    const occ = await request(app)
      .post("/api/occurrences")
      .set(as(sst))
      .send({
        type: "DANGEROUS_EVENT",
        description: `Quase-acidente ${SUFIXO}`,
        occurred_at: "2026-10-20T14:30:00.000Z",
      });
    expect(occ.status, JSON.stringify(occ.body)).toBe(201);
    ocorrencias.push(occ.body.occurrence.id);

    const sem = await request(app)
      .post(`/api/occurrences/${occ.body.occurrence.id}/actions`)
      .set(as(sst))
      .send(base());
    expect(sem.status).toBe(400);
    expect(sem.body.code).toBe("CRITERIA_REQUIRED");

    const com = await request(app)
      .post(`/api/occurrences/${occ.body.occurrence.id}/actions`)
      .set(as(sst))
      .send({ ...base(), effectiveness_criteria: "Nenhum quase-acidente igual em 90 dias" });
    expect(com.status, JSON.stringify(com.body)).toBe(201);
    acoes.push(com.body.action.id);
  });
});

describe("até a validação, o critério se completa ou corrige [B3-4-A]", () => {
  it("quem cuida do plano completa a ação aberta sem critério", async () => {
    const id = await acaoNoEstado("Aberta sem critério", "OPEN", null);
    const res = await patch(supervisor, id, "Ruído abaixo de 80 dB na nova medição");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.action.effectivenessCriteria).toBe("Ruído abaixo de 80 dB na nova medição");
    expect(res.body.action.effectivenessCriteriaLateAt, "não é registro tardio").toBeNull();
  });

  it("e corrige o critério enquanto a ação espera validação", async () => {
    const id = await acaoNoEstado("Esperando", "WAITING_VALIDATION", "Critério antigo");
    const res = await patch(sst, id, "Critério corrigido");
    expect(res.status).toBe(200);
    expect(res.body.action.effectivenessCriteria).toBe("Critério corrigido");
  });

  it("critério vazio é recusado", async () => {
    const id = await acaoNoEstado("Vazio", "OPEN", null);
    const res = await patch(sst, id, "  ");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CRITERIA_REQUIRED");
  });

  it("quem só lê o plano não mexe no critério", async () => {
    const id = await acaoNoEstado("Só leitura", "OPEN", null);
    const res = await patch(colaborador, id, "Tentativa");
    expect(res.status).toBe(403);
    const depois = await prisma.action.findUniqueOrThrow({
      where: { id },
      select: { effectivenessCriteria: true },
    });
    expect(depois.effectivenessCriteria).toBeNull();
  });

  it("ação cancelada não recebe critério", async () => {
    const id = await acaoNoEstado("Cancelada", "CANCELLED", null);
    const res = await patch(sst, id, "Tanto faz");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ACTION_CANCELLED");
  });

  it("ação de outra empresa não é achada", async () => {
    const res = await patch(sst, "00000000-0000-4000-8000-00000000ffff", "x");
    expect(res.status).toBe(404);
  });
});

describe("a ação validada sem critério o recebe depois, com nome e data [B3-4-A]", () => {
  it("quem valida registra; fica quem e quando, e a trilha guarda", async () => {
    const id = await acaoNoEstado("Validada sem critério", "VALIDATED", null);
    const antes = Date.now();
    const res = await patch(sst, id, "Zero registros de projeção fora da máquina em 60 dias");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.action.effectivenessCriteriaLateBy?.id).toBe(sst.user.id);
    expect(new Date(res.body.action.effectivenessCriteriaLateAt).getTime()).toBeGreaterThanOrEqual(
      antes - 1000,
    );

    const trilha = await prisma.auditEvent.findFirst({
      where: { entityType: "Action", entityId: id, action: "action.criteria" },
      select: { actorId: true, after: true },
    });
    expect(trilha?.actorId).toBe(sst.user.id);
    expect((trilha?.after as { afterValidation?: boolean }).afterValidation).toBe(true);
  });

  it("registrado, não muda mais", async () => {
    const id = await acaoNoEstado("Uma vez só", "VALIDATED", null);
    expect((await patch(sst, id, "Primeiro")).status).toBe(200);
    const segunda = await patch(sst, id, "Segundo");
    expect(segunda.status).toBe(409);
    expect(segunda.body.code).toBe("CRITERIA_LOCKED");
  });

  it("a validada COM critério não tem o critério reescrito", async () => {
    const id = await acaoNoEstado("Validada com critério", "VALIDATED", "O que foi aferido");
    const res = await patch(sst, id, "Outro");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CRITERIA_LOCKED");
    const depois = await prisma.action.findUniqueOrThrow({
      where: { id },
      select: { effectivenessCriteria: true },
    });
    expect(depois.effectivenessCriteria).toBe("O que foi aferido");
  });

  it("depois da validação, só quem valida registra — não basta cuidar do plano", async () => {
    const id = await acaoNoEstado("Supervisor tenta", "VALIDATED", null);
    const res = await patch(supervisor, id, "Do supervisor");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_A_VALIDATOR");
  });

  it("o Painel deixa de cobrar quando o critério é registrado", async () => {
    const titulo = `Painel cobra ${SUFIXO}`;
    const id = await acaoNoEstado("Painel cobra", "VALIDATED", null);
    const item = async () => {
      const res = await request(app).get("/api/fiscalizacao").set(as(sst));
      expect(res.status).toBe(200);
      const c = (res.body.checks as {
        id: string;
        items: { ok: boolean; label: string; detail?: string }[];
      }[]).find((x) => x.id === "plano_acao");
      return c!.items.find((i) => i.label === titulo);
    };
    const antes = await item();
    expect(antes?.ok).toBe(false);
    expect(antes?.detail).toContain("sem critério de eficácia");

    expect((await patch(sst, id, "Medido na nova inspeção")).status).toBe(200);
    const depois = await item();
    expect(depois?.detail ?? "", "a pendência não se resolvia por tela nenhuma").not.toContain(
      "sem critério de eficácia",
    );
  });

  it("a lista do plano traz quem registrou depois", async () => {
    const id = await acaoNoEstado("Na lista", "VALIDATED", null);
    await patch(sst, id, "Medido");
    const res = await request(app).get("/api/actions").set(as(sst));
    const linha = (res.body.actions as Array<{
      id: string;
      effectivenessCriteriaLateBy: { id: string } | null;
    }>).find((a) => a.id === id);
    expect(linha?.effectivenessCriteriaLateBy?.id).toBe(sst.user.id);
  });
});

describe("a tela [B3-4-A]", () => {
  it("quem pode editar: a mesma regra do servidor", () => {
    // Antes da validação: quem cuida do plano.
    for (const s of ["OPEN", "IN_PROGRESS", "WAITING_VALIDATION"]) {
      expect(podeEditarCriterio(s, false, true, false), s).toBe(true);
      expect(podeEditarCriterio(s, true, true, false), s).toBe(true);
      expect(podeEditarCriterio(s, false, false, true), `${s} sem cuidar do plano`).toBe(false);
    }
    // Depois: só quem valida, e só sem critério.
    for (const s of ["VALIDATED", "CLOSED"]) {
      expect(podeEditarCriterio(s, false, true, true), s).toBe(true);
      expect(podeEditarCriterio(s, true, true, true), `${s} com critério`).toBe(false);
      expect(podeEditarCriterio(s, false, true, false), `${s} sem validar`).toBe(false);
    }
    expect(podeEditarCriterio("CANCELLED", false, true, true)).toBe(false);
  });

  it("um nome só: nenhuma tela diz 'Como saber se deu certo' nem 'Para dar certo'", () => {
    expect(CRITERIO_LABEL).toBe("Critério de eficácia");
    for (const arquivo of [
      "ControlActionPanel.tsx",
      "ActionEvidencePanel.tsx",
      "OccurrenceDetailPage.tsx",
      "EmergenciesPage.tsx",
      "DocumentViewPage.tsx",
    ]) {
      const t = fonte("pages", arquivo);
      expect(t, arquivo).toContain("CRITERIO_LABEL");
      expect(t, arquivo).not.toContain("Como saber se deu certo");
      expect(t, arquivo).not.toContain("Para dar certo");
    }
  });

  it("os três formulários de abrir ação mandam o critério e o exigem", () => {
    const controle = plano(fonte("pages", "ControlActionPanel.tsx"));
    expect(controle).toContain("effectiveness_criteria: criteria.trim(),");
    expect(controle).toContain("if (!criteria.trim()) {");
    const ocorrencia = plano(fonte("pages", "OccurrenceDetailPage.tsx"));
    expect(ocorrencia).toContain("effectiveness_criteria: criterioDaAcao.trim(),");
    expect(ocorrencia).toContain("!criterioDaAcao.trim()");
    const emergencia = plano(fonte("pages", "EmergenciesPage.tsx"));
    expect(emergencia).toContain("effectiveness_criteria: criterioDaAcao.trim(),");
    expect(emergencia).toContain("!criterioDaAcao.trim()");
  });

  it("o painel da ação mostra o critério e o caminho de completá-lo", () => {
    const painel = plano(fonte("pages", "ActionEvidencePanel.tsx"));
    expect(painel).toContain(
      "podeEditarCriterio( action.status, Boolean(action.effectivenessCriteria), canEdit, canValidate, )",
    );
    expect(painel).toContain(
      "<CriterioDaAcao action={action} canEdit={canEditCriteria} canValidate={canReview} onSaved={onReviewed} />",
    );
    expect(painel).toContain("updateActionCriteria(action.id, texto.trim())");
    expect(painel).toContain("Registrado depois da validação");
    const pagina = plano(fonte("pages", "ActionsPage.tsx"));
    expect(pagina).toContain('const { canWrite: canEditCriteria } = useModuleAccess("acoes");');
    expect(pagina).toContain("canEditCriteria={canEditCriteria}");
  });

  it("o fato novo da trilha tem nome em português", () => {
    /* Lido como texto: `api/inspection.ts` importa o cliente HTTP do navegador. */
    expect(fonte("api", "inspection.ts")).toContain(
      '"action.criteria": "Critério de eficácia registrado",',
    );
  });
});
