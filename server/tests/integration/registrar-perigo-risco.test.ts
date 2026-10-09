import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";

/**
 * Registrar perigo e risco a partir da atividade, com a caracterização da
 * exposição que a NR-1 pede (1.5.7.3.2). [S2-A]
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
let colaborador: string;
let activityId: string;

beforeAll(async () => {
  app = createApp();
  sst = await entrar(app, "teste.sst");
  colaborador = (await entrar(app, "teste.colaborador")).token;

  const est = (
    await request(app).post("/api/establishments").set(as(sst.token)).send({ name: `Perigos ${SUFIXO}` })
  ).body.establishment;
  const sector = (
    await request(app).post("/api/sectors").set(as(sst.token)).send({ establishment_id: est.id, name: "Expedição" })
  ).body.sector;
  activityId = (
    await request(app)
      .post("/api/activities")
      .set(as(sst.token))
      .send({
        establishment_id: est.id,
        sector_id: sector.id,
        name: "Carregar caminhão",
        description: "Carrega caixas de até 20 kg na doca",
      })
  ).body.activity.id;
});

describe("registrar o perigo [S2-A]", () => {
  let hazardId: string;

  it("guarda a caracterização da exposição inteira", async () => {
    const res = await request(app)
      .post("/api/hazards")
      .set(as(sst.token))
      .send({
        activity_id: activityId,
        description: "Levantamento manual de carga",
        category: "ERGONOMIC",
        origin: "INSPECTION",
        source: "Caixas sem paleteira",
        consequences: "Lombalgia",
        exposed_group: "Ajudantes da doca",
        exposed_workers_count: 4,
        exposure_time: "3 h por turno",
        exposure_frequency: "Todos os dias",
        exposure_intensity: "até 20 kg por caixa",
        monitoring_data: "Avaliação ergonômica de 03/2026",
      });
    expect(res.status).toBe(201);
    hazardId = res.body.hazard.id;

    const lista = await request(app).get(`/api/hazards?activity_id=${activityId}`).set(as(sst.token));
    const h = (lista.body.hazards as Record<string, unknown>[]).find((x) => x.id === hazardId)!;
    expect(h.category).toBe("ERGONOMIC");
    expect(h.origin).toBe("INSPECTION");
    expect(h.exposedWorkersCount).toBe(4);
    expect(h.exposureTime).toBe("3 h por turno");
    expect(h.monitoringData).toBe("Avaliação ergonômica de 03/2026");
  });

  it("sem atividade ou sem descrição, não registra; quem só lê não registra", async () => {
    expect(
      (await request(app).post("/api/hazards").set(as(sst.token)).send({ description: "solto" })).status,
    ).toBe(400);
    expect(
      (await request(app).post("/api/hazards").set(as(sst.token)).send({ activity_id: activityId, description: " " }))
        .status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/hazards")
          .set(as(colaborador))
          .send({ activity_id: activityId, description: "Pelo colaborador" })
      ).status,
    ).toBe(403);
  });

  it("corrige o perigo e a mudança fica na trilha", async () => {
    const res = await request(app)
      .patch(`/api/hazards/${hazardId}`)
      .set(as(sst.token))
      .send({ exposed_workers_count: 6, monitoring_data: "Avaliação ergonômica de 09/2026" });
    expect(res.status).toBe(200);
    expect(res.body.hazard.exposedWorkersCount).toBe(6);
    expect(res.body.hazard.monitoringData).toBe("Avaliação ergonômica de 09/2026");

    expect((await request(app).patch(`/api/hazards/${hazardId}`).set(as(sst.token)).send({ description: "" })).status).toBe(400);
  });

  it("o risco nasce do perigo e aparece no histórico com a trilha", async () => {
    const risco = await request(app)
      .post("/api/risks")
      .set(as(sst.token))
      .send({ hazard_id: hazardId, description: "Lesão na coluna por esforço repetido" });
    expect(risco.status).toBe(201);
    const riskId = risco.body.risk.id as string;

    expect(
      (await request(app).patch(`/api/risks/${riskId}`).set(as(sst.token)).send({ description: " " })).status,
    ).toBe(400);

    const hist = await request(app).get(`/api/risks/${riskId}/historico`).set(as(sst.token));
    expect(hist.status).toBe(200);
    expect(hist.body.risk.hazard.description).toBe("Levantamento manual de carga");
    expect(hist.body.risk.hazard.activity).toBe("Carregar caminhão");
    const acoes = (hist.body.changes as { action: string }[]).map((c) => c.action);
    expect(acoes).toContain("hazard.create");
    expect(acoes).toContain("hazard.update");
    expect(acoes).toContain("risk.create");
  });
});
