import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";

/**
 * Medida de controle e ação do plano. A ação tem dono e prazo, como a NR-1
 * 1.5.5.2 exige. [S2-A] [S2-M]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
const PRAZO = "2026-12-20";

async function entrar(app: Express, login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let sst: { token: string; user: { id: string } };
let supervisor: { token: string; user: { id: string } };
let colaborador: { token: string; user: { id: string } };
let riskId: string;
let outroRiskId: string;

async function novoRisco(nome: string) {
  const est = (
    await request(app).post("/api/establishments").set(as(sst.token)).send({ name: `${nome} ${SUFIXO}` })
  ).body.establishment;
  const sector = (
    await request(app).post("/api/sectors").set(as(sst.token)).send({ establishment_id: est.id, name: "Linha" })
  ).body.sector;
  const activity = (
    await request(app).post("/api/activities").set(as(sst.token)).send({
      establishment_id: est.id,
      sector_id: sector.id,
      name: `Operar ${nome}`,
      description: "Opera a máquina de corte",
    })
  ).body.activity;
  const hazard = (
    await request(app)
      .post("/api/hazards")
      .set(as(sst.token))
      .send({ activity_id: activity.id, description: `Corte ${nome}`, category: "ACCIDENT" })
  ).body.hazard;
  return (
    await request(app)
      .post("/api/risks")
      .set(as(sst.token))
      .send({ hazard_id: hazard.id, description: `Amputação ${nome}` })
  ).body.risk.id as string;
}

beforeAll(async () => {
  app = createApp();
  sst = await entrar(app, "teste.sst");
  supervisor = await entrar(app, "teste.supervisor");
  colaborador = await entrar(app, "teste.colaborador");
  riskId = await novoRisco("Alfa");
  outroRiskId = await novoRisco("Beta");
});

describe("medida de prevenção", () => {
  let controlId: string;

  it("nasce planejada e fica ligada ao risco", async () => {
    const res = await request(app)
      .post("/api/controls")
      .set(as(sst.token))
      .send({ risk_id: riskId, type: "ENGINEERING", description: "Proteção fixa na zona de corte" });
    expect(res.status).toBe(201);
    expect(res.body.control.status).toBe("PLANNED");
    controlId = res.body.control.id;

    const lista = await request(app).get(`/api/controls?risk_id=${riskId}`).set(as(sst.token));
    expect((lista.body.controls as { id: string }[]).some((c) => c.id === controlId)).toBe(true);
  });

  it("quem só lê não cria medida", async () => {
    const res = await request(app)
      .post("/api/controls")
      .set(as(colaborador.token))
      .send({ risk_id: riskId, type: "PPE", description: "Luva" });
    expect(res.status).toBe(403);
  });

  it("a ação que implanta a medida exige dono e prazo [S2-M]", async () => {
    const semDono = await request(app)
      .post("/api/actions")
      .set(as(sst.token))
      .send({ title: "Instalar proteção", risk_id: riskId, control_id: controlId, due_date: PRAZO });
    expect(semDono.status).toBe(400);
    expect(semDono.body.message).toMatch(/respons/i);

    const semPrazo = await request(app)
      .post("/api/actions")
      .set(as(sst.token))
      .send({ title: "Instalar proteção", risk_id: riskId, control_id: controlId, assignee_id: supervisor.user.id });
    expect(semPrazo.status).toBe(400);
    expect(semPrazo.body.message).toMatch(/prazo/i);

    const ok = await request(app)
      .post("/api/actions")
      .set(as(sst.token))
      .send({
        title: "Instalar proteção fixa",
        risk_id: riskId,
        control_id: controlId,
        priority: "CRITICAL",
        assignee_id: supervisor.user.id,
        due_date: PRAZO,
        effectiveness_criteria: "Máquina não liga com a proteção aberta",
      });
    expect(ok.status).toBe(201);
    expect(ok.body.action.assigneeId).toBe(supervisor.user.id);
    expect(ok.body.action.controlId).toBe(controlId);
  });

  it("responsável de fora da organização não vale", async () => {
    const res = await request(app)
      .post("/api/actions")
      .set(as(sst.token))
      .send({
        title: "Ação com estranho",
        risk_id: riskId,
        assignee_id: "00000000-0000-4000-8000-000000000001",
        due_date: PRAZO,
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/organiza/i);
  });

  it("medida de outro risco não entra na ação", async () => {
    const res = await request(app)
      .post("/api/actions")
      .set(as(sst.token))
      .send({
        title: "Ação com medida alheia",
        risk_id: outroRiskId,
        control_id: controlId,
        assignee_id: supervisor.user.id,
        due_date: PRAZO,
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/[Mm]edida de controle/);
  });

  it("medida e ação aparecem no histórico do risco", async () => {
    const hist = await request(app).get(`/api/risks/${riskId}/historico`).set(as(sst.token));
    expect((hist.body.controls as { id: string }[]).some((c) => c.id === controlId)).toBe(true);
    const acoes = (hist.body.actions as { title: string; assignee: { name: string } | null }[]);
    const instalar = acoes.find((a) => a.title === "Instalar proteção fixa");
    expect(instalar?.assignee?.name).toBe("Supervisor Teste");
    const mudancas = (hist.body.changes as { action: string }[]).map((c) => c.action);
    expect(mudancas).toContain("control.create");
    expect(mudancas).toContain("action.create");
  });
});
