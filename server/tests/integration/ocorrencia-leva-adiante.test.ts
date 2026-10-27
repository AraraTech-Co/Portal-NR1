import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * A ocorrência leva ao que mudou depois.
 *
 * "Ações vinculadas" mostrava só o que nasceu DA ocorrência, e nenhuma tela
 * criava ação a partir dela: ficava sempre vazia. A ação do mesmo risco,
 * aberta antes do quase-acidente, existia e não aparecia ali — e a pergunta
 * do fiscal é "o que mudou depois". O caminho inverso também faltava: o
 * Histórico do risco não mostrava a ocorrência. [B3-4-C] [S7-D]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
const PRAZO = "2027-03-20";

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let sst: { token: string; user: { id: string } };
let supervisor: { token: string; user: { id: string } };
let risco = "";
let ocorrencia = "";
let acaoAnterior = "";
const criadas: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

async function abrirOcorrencia() {
  const res = await request(app)
    .get(`/api/occurrences/${ocorrencia}`)
    .set(as(sst.token));
  expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
  return res.body.occurrence as {
    actions: { id: string; title: string; from_occurrence: boolean }[];
  };
}

beforeAll(async () => {
  app = createApp();
  sst = await entrar("teste.sst");
  supervisor = await entrar("teste.supervisor");

  const r = await prisma.risk.findFirstOrThrow({
    where: { organizationId: ORG_ID, archivedAt: null },
    select: { id: true },
  });
  risco = r.id;

  /*
    A ação do risco nasce ANTES da ocorrência: é o caso do achado, em que a
    proteção já estava planejada quando o quase-acidente aconteceu.
  */
  const antes = await request(app)
    .post("/api/actions")
    .set(as(sst.token))
    .send({
      effectiveness_criteria: "Critério do teste",
      title: `Proteção planejada antes ${SUFIXO}`,
      risk_id: risco,
      assignee_id: supervisor.user.id,
      due_date: PRAZO,
      priority: "HIGH",
      deadline_justification: "prazo do teste",
    });
  expect(antes.status, JSON.stringify(antes.body)).toBe(201);
  acaoAnterior = antes.body.action.id;
  criadas.push(acaoAnterior);

  const occ = await request(app)
    .post("/api/occurrences")
    .set(as(sst.token))
    .send({
      type: "DANGEROUS_EVENT",
      description: `Quase-acidente na placa ${SUFIXO}`,
      occurred_at: new Date("2026-10-22T13:00:00.000Z").toISOString(),
      risk_id: risco,
    });
  expect(occ.status, JSON.stringify(occ.body)).toBe(201);
  ocorrencia = occ.body.occurrence.id;
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({
    where: { entityId: { in: [...criadas, ocorrencia] } },
  });
  await prisma.action.deleteMany({ where: { id: { in: criadas } } });
  await prisma.occurrence.deleteMany({ where: { id: ocorrencia } });
});

describe("ações vinculadas deixam de ficar vazias [B3-4-C]", () => {
  it("a ação do risco, aberta antes da ocorrência, aparece — marcada como do risco", async () => {
    const aberta = await abrirOcorrencia();
    const anterior = aberta.actions.find((a) => a.id === acaoAnterior);
    /*
      É o defeito do achado: a tela dizia "Nenhuma ação gerada a partir desta
      ocorrência" enquanto a ação do mesmo risco existia.
    */
    expect(anterior, "a ação do risco aparece").toBeTruthy();
    expect(anterior!.from_occurrence, "ela não nasceu da ocorrência").toBe(false);
  });

  it("a ação aberta pela ocorrência aparece marcada como dela", async () => {
    const res = await request(app)
      .post(`/api/occurrences/${ocorrencia}/actions`)
      .set(as(sst.token))
      .send({
        effectiveness_criteria: "Critério do teste",
        title: `Trocar a placa ${SUFIXO}`,
        assignee_id: supervisor.user.id,
        due_date: PRAZO,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    criadas.push(res.body.action.id);

    const aberta = await abrirOcorrencia();
    const nova = aberta.actions.find((a) => a.id === res.body.action.id);
    expect(nova, "a ação nova aparece").toBeTruthy();
    expect(nova!.from_occurrence).toBe(true);
    expect(
      aberta.actions.length,
      "as duas convivem: a de antes e a de depois",
    ).toBeGreaterThan(1);
  });

  it("abrir ação pela ocorrência exige responsável e prazo, como no plano [S2-M]", async () => {
    const semResponsavel = await request(app)
      .post(`/api/occurrences/${ocorrencia}/actions`)
      .set(as(sst.token))
      .send({ effectiveness_criteria: "Critério do teste", title: `Sem responsável ${SUFIXO}`, due_date: PRAZO });
    expect(semResponsavel.status, JSON.stringify(semResponsavel.body)).toBe(400);
    expect(semResponsavel.body.message).toMatch(/respons/i);

    const semPrazo = await request(app)
      .post(`/api/occurrences/${ocorrencia}/actions`)
      .set(as(sst.token))
      .send({ effectiveness_criteria: "Critério do teste", title: `Sem prazo ${SUFIXO}`, assignee_id: supervisor.user.id });
    expect(semPrazo.status, JSON.stringify(semPrazo.body)).toBe(400);
    expect(semPrazo.body.message).toMatch(/prazo/i);
  });
});

describe("o caminho inverso: o histórico do risco mostra a ocorrência [B3-4-C]", () => {
  it("a ocorrência registrada aparece no histórico do risco", async () => {
    const res = await request(app)
      .get(`/api/risks/${risco}/historico`)
      .set(as(sst.token));
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    const fatos = res.body.changes as { action: string; entityType: string }[];
    expect(
      fatos.some((c) => c.action === "occurrence.create"),
      "o quase-acidente entra no histórico do risco",
    ).toBe(true);
  });

  it("a análise da ocorrência também entra", async () => {
    const analise = await request(app)
      .post(`/api/occurrences/${ocorrencia}/analyze`)
      .set(as(sst.token))
      .send({
        generating_situation: `Placa sem proteção ${SUFIXO}`,
        organizational_data: "Turno da tarde",
        prevention_review: "Rever o procedimento",
      });
    expect(analise.status, JSON.stringify(analise.body)).toBe(200);

    const res = await request(app)
      .get(`/api/risks/${risco}/historico`)
      .set(as(sst.token));
    const fatos = (res.body.changes as { action: string }[]).map((c) => c.action);
    expect(fatos).toContain("occurrence.analyze");
  });
});
