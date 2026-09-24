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

describe("Participation module (NR-1 1.5.3.3)", () => {
  let app: Express;
  let token: string;
  let participationId: string;

  beforeAll(async () => {
    app = createApp();
    token = await login(app, "admin");
  });

  it("rejects invalid type", async () => {
    const res = await request(app)
      .post("/api/participations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        type: "SURVEY",
        subject: "Consulta",
        occurred_at: "2026-09-01T10:00:00.000Z",
      });
    expect(res.status).toBe(400);
  });

  it("creates consultation record", async () => {
    const res = await request(app)
      .post("/api/participations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        type: "CONSULTATION",
        subject: "Consulta sobre riscos da usinagem",
        description: "Trabalhadores ouvidos sobre ruído e postura",
        occurred_at: "2026-09-12T11:00:00.000Z",
        establishment_id: EST_ID,
        participants_count: 8,
      });
    expect(res.status).toBe(201);
    expect(res.body.participation.type).toBe("CONSULTATION");
    expect(res.body.participation.participantsCount).toBe(8);
    participationId = res.body.participation.id;
  });

  it("updates and attaches evidence", async () => {
    const patch = await request(app)
      .patch(`/api/participations/${participationId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "CIPA_MANIFESTATION", participants_count: 10 });
    expect(patch.status).toBe(200);
    expect(patch.body.participation.type).toBe("CIPA_MANIFESTATION");

    const ev = await request(app)
      .post(`/api/participations/${participationId}/evidences`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        file_name: "ata-cipa.pdf",
        mime_type: "application/pdf",
        description: "Ata da reunião CIPA",
      });
    expect(ev.status).toBe(201);
    expect(ev.body.evidence.participationId).toBe(participationId);

    const detail = await request(app)
      .get(`/api/participations/${participationId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.participation.evidences.length).toBeGreaterThanOrEqual(1);
  });

  it("lists by type filter", async () => {
    const res = await request(app)
      .get("/api/participations?type=CIPA_MANIFESTATION")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(
      res.body.participations.every(
        (p: { type: string }) => p.type === "CIPA_MANIFESTATION",
      ),
    ).toBe(true);
  });
});
