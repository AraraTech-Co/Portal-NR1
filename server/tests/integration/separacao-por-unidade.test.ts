import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";

/**
 * Cada unidade com o que é dela.
 *
 * A ocorrência de uma unidade não se liga a risco de outra [S3-D] [S2-F]; o
 * plano de ação e as ocorrências filtram por unidade [S6-D] [CB-24]; e o
 * documento emitido por unidade para de levar ação da organização inteira.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

async function entrar(app: Express, login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let sst: { token: string; user: { id: string } };
let supervisor: { token: string; user: { id: string } };

/** Uma unidade com atividade, perigo e risco próprios. */
async function unidadeComRisco(nome: string) {
  const est = (
    await request(app)
      .post("/api/establishments")
      .set(as(sst.token))
      .send({ name: `${nome} ${SUFIXO}` })
  ).body.establishment;
  const setor = (
    await request(app)
      .post("/api/sectors")
      .set(as(sst.token))
      .send({ establishment_id: est.id, name: "Produção" })
  ).body.sector;
  const atividade = (
    await request(app).post("/api/activities").set(as(sst.token)).send({
      establishment_id: est.id,
      sector_id: setor.id,
      name: `Operar máquina ${nome} ${SUFIXO}`,
      description: "Opera máquina no setor de produção",
    })
  ).body.activity;
  const perigo = (
    await request(app).post("/api/hazards").set(as(sst.token)).send({
      activity_id: atividade.id,
      description: `Peça girando sem proteção ${nome} ${SUFIXO}`,
      category: "ACCIDENT",
    })
  ).body.hazard;
  const risco = (
    await request(app)
      .post("/api/risks")
      .set(as(sst.token))
      .send({ hazard_id: perigo.id, description: `Corte na mão ${nome} ${SUFIXO}` })
  ).body.risk;
  return { establishmentId: est.id as string, riskId: risco.id as string, name: est.name as string };
}

beforeAll(async () => {
  app = createApp();
  sst = await entrar(app, "teste.sst");
  supervisor = await entrar(app, "teste.supervisor");
});

describe("a ocorrência fica na sua unidade [S3-D] [S2-F]", () => {
  it("risco de outra unidade é recusado, dizendo de onde ele é", async () => {
    const a = await unidadeComRisco("Alfa");
    const b = await unidadeComRisco("Beta");

    const errada = await request(app)
      .post("/api/occurrences")
      .set(as(supervisor.token))
      .send({
        type: "DANGEROUS_EVENT",
        description: `Quase-acidente ${SUFIXO}`,
        occurred_at: "2026-10-05",
        establishment_id: a.establishmentId,
        risk_id: b.riskId,
      });
    expect(errada.status).toBe(400);
    expect(errada.body.message).toMatch(new RegExp(b.name));
    expect(errada.body.message).toMatch(/mesma unidade/i);

    const certa = await request(app)
      .post("/api/occurrences")
      .set(as(supervisor.token))
      .send({
        type: "DANGEROUS_EVENT",
        description: `Quase-acidente certo ${SUFIXO}`,
        occurred_at: "2026-10-05",
        establishment_id: a.establishmentId,
        risk_id: a.riskId,
      });
    expect(certa.status).toBe(201);
  });

  it("trocar o risco depois também respeita a unidade", async () => {
    const a = await unidadeComRisco("Gama");
    const b = await unidadeComRisco("Delta");

    const criada = await request(app)
      .post("/api/occurrences")
      .set(as(supervisor.token))
      .send({
        type: "ACCIDENT",
        description: `Acidente ${SUFIXO}`,
        occurred_at: "2026-10-06",
        establishment_id: a.establishmentId,
      });
    expect(criada.status).toBe(201);

    const troca = await request(app)
      .patch(`/api/occurrences/${criada.body.occurrence.id}`)
      .set(as(sst.token))
      .send({ risk_id: b.riskId });
    expect(troca.status).toBe(400);

    const ok = await request(app)
      .patch(`/api/occurrences/${criada.body.occurrence.id}`)
      .set(as(sst.token))
      .send({ risk_id: a.riskId });
    expect(ok.status).toBe(200);
  });

  it("ocorrência sem unidade aceita qualquer risco da empresa", async () => {
    const a = await unidadeComRisco("Epsilon");
    const res = await request(app)
      .post("/api/occurrences")
      .set(as(supervisor.token))
      .send({
        type: "DANGEROUS_EVENT",
        description: `Sem unidade ${SUFIXO}`,
        occurred_at: "2026-10-07",
        risk_id: a.riskId,
      });
    expect(res.status).toBe(201);
  });
});

describe("o risco diz de que unidade é [S3-D]", () => {
  it("a lista traz a unidade e aceita filtrar por ela", async () => {
    const a = await unidadeComRisco("Zeta");

    const todos = await request(app).get("/api/risks").set(as(sst.token));
    expect(todos.status).toBe(200);
    const nosso = (todos.body.risks as { id: string; establishment: { id: string } | null }[]).find(
      (r) => r.id === a.riskId,
    );
    expect(nosso?.establishment?.id, "o risco diz de onde é").toBe(a.establishmentId);

    const daUnidade = await request(app)
      .get(`/api/risks?establishment_id=${a.establishmentId}`)
      .set(as(sst.token));
    const ids = (daUnidade.body.risks as { id: string }[]).map((r) => r.id);
    expect(ids).toContain(a.riskId);
    expect(ids.length).toBeLessThan((todos.body.risks as unknown[]).length);
  });
});

describe("o plano de ação separa unidades [S6-D] [CB-24]", () => {
  it("a ação traz a unidade e a lista filtra por ela", async () => {
    const a = await unidadeComRisco("Eta");
    const criada = await request(app)
      .post("/api/actions")
      .set(as(sst.token))
      .send({
        effectiveness_criteria: "Critério do teste",
        title: `Instalar proteção ${SUFIXO}`,
        risk_id: a.riskId,
        assignee_id: supervisor.user.id,
        due_date: "2027-03-01",
      });
    expect(criada.status).toBe(201);

    const daUnidade = await request(app)
      .get(`/api/actions?establishment_id=${a.establishmentId}`)
      .set(as(sst.token));
    const acoes = daUnidade.body.actions as {
      id: string;
      establishment: { id: string; name: string } | null;
    }[];
    expect(acoes.length).toBe(1);
    expect(acoes[0]!.id).toBe(criada.body.action.id);
    expect(acoes[0]!.establishment?.id).toBe(a.establishmentId);
  });

  it("o plano emitido por unidade não leva ação da organização inteira", async () => {
    const a = await unidadeComRisco("Teta");
    await request(app)
      .post("/api/actions")
      .set(as(sst.token))
      .send({
        effectiveness_criteria: "Critério do teste",
        title: `Só desta unidade ${SUFIXO}`,
        risk_id: a.riskId,
        assignee_id: supervisor.user.id,
        due_date: "2027-03-01",
      });
    // Ação sem risco: pertence à organização, não a uma unidade.
    await request(app)
      .post("/api/actions")
      .set(as(sst.token))
      .send({
        effectiveness_criteria: "Critério do teste",
        title: `Sem risco ${SUFIXO}`,
        assignee_id: supervisor.user.id,
        due_date: "2027-03-01",
      });

    const documento = await request(app)
      .post("/api/pgr-documents")
      .set(as(sst.token))
      .send({
        type: "ACTION_PLAN",
        establishment_id: a.establishmentId,
        responsible_name: `Responsável ${SUFIXO}`,
      });
    expect(documento.status).toBe(201);

    const aberto = await request(app)
      .get(`/api/pgr-documents/${documento.body.document.id}`)
      .set(as(sst.token));
    const titulos = (aberto.body.document.content.actions as { title: string }[]).map(
      (x) => x.title,
    );
    expect(titulos).toContain(`Só desta unidade ${SUFIXO}`);
    expect(titulos, "ação sem risco não é desta unidade").not.toContain(
      `Sem risco ${SUFIXO}`,
    );
  });
});
