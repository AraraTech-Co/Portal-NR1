import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import type { Express } from "express";

const EST_ID = "00000000-0000-4000-8000-000000000010";
const SECTOR_ID = "00000000-0000-4000-8000-000000000011";
const ACT_ID = "00000000-0000-4000-8000-000000000013";

async function login(app: Express, loginId: string) {
  const res = await request(app)
    .post("/api/auth")
    .send({ login: loginId, password: "admin123" });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

describe("AEP module", () => {
  let app: Express;
  let token: string;

  beforeAll(async () => {
    app = createApp();
    token = await login(app, "admin");
  });

  it("lists psychosocial catalog", async () => {
    const res = await request(app)
      .get("/api/psychosocial-factors")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.factors.length).toBeGreaterThan(5);
    expect(res.body.factors[0]).toHaveProperty("fieldQuestion");
  });

  it("rejects questionnaire without anonymity measures", async () => {
    const res = await request(app)
      .post("/api/aeps")
      .set("Authorization", `Bearer ${token}`)
      .send({
        establishment_id: EST_ID,
        scope_description: "Posto de usinagem",
        method: "QUESTIONNAIRE",
      });
    expect(res.status).toBe(400);
  });

  it("creates AEP, adds hazard into inventory, concludes with rules", async () => {
    const created = await request(app)
      .post("/api/aeps")
      .set("Authorization", `Bearer ${token}`)
      .send({
        establishment_id: EST_ID,
        sector_id: SECTOR_ID,
        activity_id: ACT_ID,
        scope_description: "Operação de torno — organização do trabalho",
        method: "OBSERVATION",
        method_rationale: "Observação direta no posto",
        workers_consulted: 2,
      });
    expect(created.status).toBe(201);
    expect(created.body.aep.status).toBe("DRAFT");
    const aepId = created.body.aep.id as string;

    const noFind = await request(app)
      .post(`/api/aeps/${aepId}/conclude`)
      .set("Authorization", `Bearer ${token}`)
      .send({ needs_aet: false });
    expect(noFind.status).toBe(400);

    const hazard = await request(app)
      .post(`/api/aeps/${aepId}/hazards`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        factor_id: "OVERLOAD",
        description: "Sobrecarga de metas no turno",
        exposed_workers_count: 4,
      });
    expect(hazard.status).toBe(201);
    expect(hazard.body.hazard.category).toBe("PSYCHOSOCIAL");
    expect(hazard.body.hazard.aepId).toBe(aepId);
    expect(hazard.body.hazard.monitoringData).toMatch(/sobrecarga/i);

    const ev = await request(app)
      .post(`/api/aeps/${aepId}/evidences`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        file_name: "observacao.pdf",
        mime_type: "application/pdf",
        description: "Registro de observação",
      });
    expect(ev.status).toBe(201);

    const needsAetNoReason = await request(app)
      .post(`/api/aeps/${aepId}/conclude`)
      .set("Authorization", `Bearer ${token}`)
      .send({ needs_aet: true });
    expect(needsAetNoReason.status).toBe(400);

    const concluded = await request(app)
      .post(`/api/aeps/${aepId}/conclude`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        needs_aet: true,
        aet_reason: "Indicação do PCMSO para aprofundamento",
        findings: "Sobrecarga confirmada na observação",
      });
    expect(concluded.status).toBe(200);
    expect(concluded.body.aep.status).toBe("CONCLUDED");
    expect(concluded.body.aep.needsAet).toBe(true);

    const edit = await request(app)
      .patch(`/api/aeps/${aepId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ findings: "tentativa" });
    expect(edit.status).toBe(409);

    const inventory = await request(app)
      .get("/api/inventory")
      .set("Authorization", `Bearer ${token}`);
    expect(inventory.status).toBe(200);
    const fromAep = inventory.body.inventory.items.find(
      (i: { hazard_id: string }) => i.hazard_id === hazard.body.hazard.id,
    );
    expect(fromAep).toBeTruthy();
    expect(fromAep.category).toBe("PSYCHOSOCIAL");
  });

  it("can conclude without hazards if findings justify", async () => {
    const created = await request(app)
      .post("/api/aeps")
      .set("Authorization", `Bearer ${token}`)
      .send({
        establishment_id: EST_ID,
        activity_id: ACT_ID,
        scope_description: "Revisão sem fatores",
        method: "INTERVIEW",
      });
    const aepId = created.body.aep.id as string;

    const ok = await request(app)
      .post(`/api/aeps/${aepId}/conclude`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        needs_aet: false,
        findings:
          "Entrevistas não identificaram fatores psicossociais relevantes neste escopo.",
      });
    expect(ok.status).toBe(200);
    expect(ok.body.aep.status).toBe("CONCLUDED");
  });
});
