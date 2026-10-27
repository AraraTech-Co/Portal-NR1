import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O que aconteceu com a ação entra na trilha, e o aviso some de quem já agiu.
 *
 * A conclusão, o envio da prova e a aprovação não entravam no histórico de
 * auditoria, então "Tudo o que aconteceu com este risco" e o Histórico do
 * Painel paravam em "Ação aberta" — justamente o que o fiscal pede [CB-58]
 * [S7-D]. O aviso de ação concluída ia para quem ABRIU a ação, que desde a
 * revisão do OB-6 pode nem poder validar [CB-56]. E depois de aprovar, quem
 * validou continuava com o aviso "espera a sua validação" por ler [CB-59].
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
const PRAZO = "2027-02-20";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let sst: { token: string; user: { id: string } };
let supervisor: { token: string; user: { id: string } };
let gerente: { token: string; user: { id: string } };
let risco = "";
const acoes: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

/** Ação do risco, executada pelo supervisor e concluída com prova. */
async function acaoConcluida(titulo: string) {
  const criada = await request(app)
    .post("/api/actions")
    .set(as(sst.token))
    .send({
      effectiveness_criteria: "Critério do teste",
      title: `${titulo} ${SUFIXO}`,
      risk_id: risco,
      assignee_id: supervisor.user.id,
      due_date: PRAZO,
      priority: "HIGH",
      deadline_justification: "prazo do teste",
    });
  expect(criada.status, JSON.stringify(criada.body)).toBe(201);
  const id = criada.body.action.id as string;
  acoes.push(id);

  const prova = await request(app)
    .post("/api/evidences")
    .set(as(supervisor.token))
    .send({
      action_id: id,
      type: "PHOTO",
      file_name: "feito.png",
      mime_type: "image/png",
      content_base64: PNG.toString("base64"),
      description: "Proteção instalada",
    });
  expect(prova.status, JSON.stringify(prova.body)).toBe(201);

  const fim = await request(app)
    .post(`/api/actions/${id}/complete`)
    .set(as(supervisor.token));
  expect(fim.status, JSON.stringify(fim.body)).toBe(200);
  return id;
}

/** O que a trilha guardou sobre esta ação. */
async function trilha(actionId: string) {
  const rows = await prisma.auditEvent.findMany({
    where: { organizationId: ORG_ID, entityId: actionId },
    select: { action: true, actorId: true },
  });
  return rows;
}

beforeAll(async () => {
  app = createApp();
  sst = await entrar("teste.sst");
  supervisor = await entrar("teste.supervisor");
  gerente = await entrar("teste.gerente");

  const r = await prisma.risk.findFirstOrThrow({
    where: { organizationId: ORG_ID, archivedAt: null },
    select: { id: true },
  });
  risco = r.id;
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: acoes } } });
  await prisma.notification.deleteMany({
    where: { entityType: "Action", entityId: { in: acoes } },
  });
  await prisma.evidence.deleteMany({ where: { actionId: { in: acoes } } });
  await prisma.action.deleteMany({ where: { id: { in: acoes } } });
});

describe("cada passo da ação entra na trilha [CB-58] [S7-D]", () => {
  it("prova enviada, conclusão e validação ficam registradas, com quem fez", async () => {
    const id = await acaoConcluida("Instalar proteção");

    const antes = await trilha(id);
    expect(antes.map((e) => e.action)).toContain("action.evidence");
    expect(antes.map((e) => e.action)).toContain("action.complete");
    expect(
      antes.find((e) => e.action === "action.complete")?.actorId,
      "quem concluiu foi o responsável",
    ).toBe(supervisor.user.id);

    const aprovada = await request(app)
      .post(`/api/actions/${id}/review`)
      .set(as(sst.token))
      .send({ decision: "approve", effectiveness_result: `Conferido ${SUFIXO}` });
    expect(aprovada.status, JSON.stringify(aprovada.body)).toBe(200);

    const depois = await trilha(id);
    const validacao = depois.find((e) => e.action === "action.validate");
    expect(validacao, "a validação entra na trilha").toBeTruthy();
    expect(validacao!.actorId, "com quem validou").toBe(sst.user.id);
  });

  it("a recusa também entra, e é distinguível da aprovação", async () => {
    const id = await acaoConcluida("Trocar a fechadura");
    const recusada = await request(app)
      .post(`/api/actions/${id}/review`)
      .set(as(sst.token))
      .send({ decision: "reject", rejection_reason: `Foto ruim ${SUFIXO}` });
    expect(recusada.status, JSON.stringify(recusada.body)).toBe(200);

    const rows = await trilha(id);
    expect(rows.map((e) => e.action)).toContain("action.reject");
    expect(rows.map((e) => e.action)).not.toContain("action.validate");
  });

  it("o Histórico do risco mostra os passos da ação, não só a abertura", async () => {
    const id = await acaoConcluida("Sinalizar o piso");
    await request(app)
      .post(`/api/actions/${id}/review`)
      .set(as(sst.token))
      .send({ decision: "approve", effectiveness_result: "ok" })
      .expect(200);

    const res = await request(app)
      .get(`/api/risks/${risco}/historico`)
      .set(as(sst.token));
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    const acoesNaTrilha = (res.body.changes as { action: string }[]).map(
      (c) => c.action,
    );
    /*
      É o defeito do achado: o histórico parava em "Ação aberta", sem a
      conclusão nem a validação.
    */
    expect(acoesNaTrilha).toContain("action.complete");
    expect(acoesNaTrilha).toContain("action.validate");
    expect(acoesNaTrilha).toContain("action.evidence");
  });
});

describe("quem é avisado da ação concluída [CB-56]", () => {
  it("o aviso vai para quem pode validar, não para quem abriu", async () => {
    const abertaPeloGerente = await request(app)
      .post("/api/actions")
      .set(as(gerente.token))
      .send({
        effectiveness_criteria: "Critério do teste",
        title: `Aberta pelo gerente ${SUFIXO}`,
        risk_id: risco,
        assignee_id: supervisor.user.id,
        due_date: PRAZO,
        priority: "HIGH",
        deadline_justification: "prazo do teste",
      });
    expect(abertaPeloGerente.status, JSON.stringify(abertaPeloGerente.body)).toBe(201);
    const id = abertaPeloGerente.body.action.id as string;
    acoes.push(id);

    await request(app)
      .post("/api/evidences")
      .set(as(supervisor.token))
      .send({
        action_id: id,
        type: "PHOTO",
        file_name: "feito.png",
        mime_type: "image/png",
        content_base64: PNG.toString("base64"),
      })
      .expect(201);
    await request(app)
      .post(`/api/actions/${id}/complete`)
      .set(as(supervisor.token))
      .expect(200);

    const avisados = await prisma.notification.findMany({
      where: { entityType: "Action", entityId: id, kind: "ACTION_WAITING_VALIDATION" },
      select: { userId: true },
    });
    const quem = avisados.map((a) => a.userId);
    expect(quem, "quem valida é avisado").toContain(sst.user.id);
    /*
      O gerente abriu a ação, mas pela revisão do OB-6 ele não valida: o
      aviso ia para a caixa de quem não tem o que fazer com ele.
    */
    expect(quem, "quem abriu e não valida não é avisado").not.toContain(
      gerente.user.id,
    );
    expect(quem, "quem executou nunca valida").not.toContain(supervisor.user.id);
  });
});

describe("validar dá o aviso por lido [CB-59]", () => {
  it("depois de aprovar, quem validou não vê mais 'espera a sua validação'", async () => {
    const id = await acaoConcluida("Guardar a escada");

    const pendenteAntes = await prisma.notification.count({
      where: {
        userId: sst.user.id,
        entityType: "Action",
        entityId: id,
        kind: "ACTION_WAITING_VALIDATION",
        readAt: null,
      },
    });
    expect(pendenteAntes, "o aviso chegou a quem valida").toBe(1);

    await request(app)
      .post(`/api/actions/${id}/review`)
      .set(as(sst.token))
      .send({ decision: "approve", effectiveness_result: "ok" })
      .expect(200);

    const pendenteDepois = await prisma.notification.count({
      where: {
        userId: sst.user.id,
        entityType: "Action",
        entityId: id,
        kind: "ACTION_WAITING_VALIDATION",
        readAt: null,
      },
    });
    expect(pendenteDepois, "via como pendente o que acabara de fazer").toBe(0);
  });
});
