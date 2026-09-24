import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import type { Express } from "express";

const EST_ID = "00000000-0000-4000-8000-000000000010";

async function login(app: Express, loginId: string) {
  const res = await request(app)
    .post("/api/auth")
    .send({ login: loginId, password: "admin123" });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

describe("Emergency module (NR-1 1.5.6)", () => {
  let app: Express;
  let token: string;
  let procedureId: string;
  let drillId: string;

  beforeAll(async () => {
    app = createApp();
    token = await login(app, "admin");
  });

  it("rejects procedure without 1.5.6.2 a fields", async () => {
    const res = await request(app)
      .post("/api/emergency-procedures")
      .set("Authorization", `Bearer ${token}`)
      .send({
        establishment_id: EST_ID,
        scenario: "Incêndio no setor de usinagem",
      });
    expect(res.status).toBe(400);
  });

  it("creates procedure with required fields", async () => {
    const res = await request(app)
      .post("/api/emergency-procedures")
      .set("Authorization", `Bearer ${token}`)
      .send({
        establishment_id: EST_ID,
        scenario: "Incêndio no setor de usinagem",
        first_aid_means: "Kit A e maca; SAMU 192",
        responsibles: "Brigada + supervisor de turno",
        evacuation_plan: "Rota A até ponto de encontro sul",
        large_scale_measures: "Acionar corpo de bombeiros e isolamento",
        drill_frequency_months: 6,
      });
    expect(res.status).toBe(201);
    expect(res.body.procedure.scenario).toContain("Incêndio");
    expect(res.body.procedure.drillFrequencyMonths).toBe(6);
    procedureId = res.body.procedure.id;
  });

  it("lists and updates procedure", async () => {
    const list = await request(app)
      .get("/api/emergency-procedures")
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(
      list.body.procedures.some((p: { id: string }) => p.id === procedureId),
    ).toBe(true);

    const patch = await request(app)
      .patch(`/api/emergency-procedures/${procedureId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ evacuation_plan: "Rota B — ponto de encontro norte" });
    expect(patch.status).toBe(200);
    expect(patch.body.procedure.evacuationPlan).toContain("Rota B");
  });

  it("records drill and attaches evidence (1.5.6.3.1)", async () => {
    const drill = await request(app)
      .post(`/api/emergency-procedures/${procedureId}/drills`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        performed_at: "2026-09-15T09:00:00.000Z",
        participants: 12,
        findings: "Tempo de abandono dentro do esperado",
      });
    expect(drill.status).toBe(201);
    expect(drill.body.drill.participants).toBe(12);
    drillId = drill.body.drill.id;

    const ev = await request(app)
      .post(
        `/api/emergency-procedures/${procedureId}/drills/${drillId}/evidences`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        file_name: "lista-presenca.pdf",
        mime_type: "application/pdf",
        description: "Lista de presença do simulado",
      });
    expect(ev.status).toBe(201);
    expect(ev.body.evidence.drillId).toBe(drillId);

    const detail = await request(app)
      .get(`/api/emergency-procedures/${procedureId}/drills/${drillId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.drill.evidences.length).toBeGreaterThanOrEqual(1);
  });

  it("archives procedure", async () => {
    const res = await request(app)
      .delete(`/api/emergency-procedures/${procedureId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.procedure.archivedAt).toBeTruthy();

    const list = await request(app)
      .get("/api/emergency-procedures")
      .set("Authorization", `Bearer ${token}`);
    expect(
      list.body.procedures.some((p: { id: string }) => p.id === procedureId),
    ).toBe(false);
  });
});
