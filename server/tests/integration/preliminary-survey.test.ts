import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import type { Express } from "express";

const EST_ID = "00000000-0000-4000-8000-000000000010";
const ACT_ID = "00000000-0000-4000-8000-000000000013";

async function login(app: Express, loginId: string) {
  const res = await request(app)
    .post("/api/auth")
    .send({ login: loginId, password: "admin123" });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

describe("Preliminary survey (NR-1 1.5.4.2)", () => {
  let app: Express;
  let token: string;
  let surveyId: string;

  beforeAll(async () => {
    app = createApp();
    token = await login(app, "admin");
  });

  it("creates survey and lists it", async () => {
    const created = await request(app)
      .post("/api/preliminary-surveys")
      .set("Authorization", `Bearer ${token}`)
      .send({
        establishment_id: EST_ID,
        trigger: "EXISTING_ACTIVITIES",
        description: "Revisão da linha de usinagem",
      });
    expect(created.status).toBe(201);
    expect(created.body.survey.trigger).toBe("EXISTING_ACTIVITIES");
    surveyId = created.body.survey.id;

    const list = await request(app)
      .get("/api/preliminary-surveys")
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.surveys.some((s: { id: string }) => s.id === surveyId)).toBe(
      true,
    );
  });

  it("rejects IMMEDIATE_MEASURE without measure_taken", async () => {
    const res = await request(app)
      .post(`/api/preliminary-surveys/${surveyId}/items`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        description: "Ruído elevado no torno",
        outcome: "IMMEDIATE_MEASURE",
      });
    expect(res.status).toBe(400);
  });

  it("records IMMEDIATE_MEASURE with measure", async () => {
    const res = await request(app)
      .post(`/api/preliminary-surveys/${surveyId}/items`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        description: "Ruído elevado no torno",
        outcome: "IMMEDIATE_MEASURE",
        measure_taken: "Proteção acústica instalada no posto",
        activity_id: ACT_ID,
      });
    expect(res.status).toBe(201);
    expect(res.body.item.outcome).toBe("IMMEDIATE_MEASURE");
    expect(res.body.hazard).toBeNull();
    expect(res.body.action).toBeNull();
  });

  it("DEFERRED_TO_ACTION_PLAN creates hazard + action", async () => {
    const res = await request(app)
      .post(`/api/preliminary-surveys/${surveyId}/items`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        description: "Exposição a névoa de óleo sem medida imediata",
        outcome: "DEFERRED_TO_ACTION_PLAN",
        activity_id: ACT_ID,
        category: "CHEMICAL",
      });
    expect(res.status).toBe(201);
    expect(res.body.hazard).toBeTruthy();
    expect(res.body.hazard.category).toBe("CHEMICAL");
    expect(res.body.hazard.status).toBe("IDENTIFIED");
    expect(res.body.action).toBeTruthy();
    expect(res.body.action.priority).toBe("HIGH");

    const inventory = await request(app)
      .get("/api/inventory")
      .set("Authorization", `Bearer ${token}`);
    expect(inventory.status).toBe(200);
    const found = inventory.body.inventory.items.find(
      (i: { hazard_id: string }) => i.hazard_id === res.body.hazard.id,
    );
    expect(found).toBeTruthy();
  });

  it("ESCALATED_TO_ASSESSMENT creates hazard only", async () => {
    const res = await request(app)
      .post(`/api/preliminary-surveys/${surveyId}/items`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        description: "Postura forçada a avaliar formalmente",
        outcome: "ESCALATED_TO_ASSESSMENT",
        activity_id: ACT_ID,
        category: "ERGONOMIC",
      });
    expect(res.status).toBe(201);
    expect(res.body.hazard).toBeTruthy();
    expect(res.body.action).toBeNull();

    const detail = await request(app)
      .get(`/api/preliminary-surveys/${surveyId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.survey.items.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects deferred without activity_id", async () => {
    const res = await request(app)
      .post(`/api/preliminary-surveys/${surveyId}/items`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        description: "Sem atividade",
        outcome: "DEFERRED_TO_ACTION_PLAN",
      });
    expect(res.status).toBe(400);
  });
});
