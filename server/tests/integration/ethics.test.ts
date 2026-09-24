import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import type { Express } from "express";

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const EST_ID = "00000000-0000-4000-8000-000000000010";

async function login(app: Express, loginId: string) {
  const res = await request(app)
    .post("/api/auth")
    .send({ login: loginId, password: "admin123" });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

describe("Ethics channel (Lei 14.457)", () => {
  let app: Express;
  let committeeToken: string;
  let protocol: string;
  let accessCode: string;
  let reportId: string;

  beforeAll(async () => {
    app = createApp();
    committeeToken = await login(app, "admin");
  });

  it("creates anonymous report and returns access_code once", async () => {
    const res = await request(app)
      .post("/api/ethics-reports")
      .send({
        organization_id: ORG_ID,
        category: "HARASSMENT_MORAL",
        description: "Situação de constrangimento reiterado no setor",
        establishment_id: EST_ID,
        is_anonymous: true,
      });
    expect(res.status).toBe(201);
    expect(res.body.report.protocol).toMatch(/^CX-\d{4}$/);
    expect(res.body.report.isAnonymous).toBe(true);
    expect(res.body.access_code).toBeTruthy();
    expect(res.body.report).not.toHaveProperty("accessCodeHash");
    protocol = res.body.report.protocol;
    accessCode = res.body.access_code;
    reportId = res.body.report.id;
  });

  it("tracks by protocol + code", async () => {
    const res = await request(app)
      .post("/api/ethics-reports/track")
      .send({ protocol, access_code: accessCode, organization_id: ORG_ID });
    expect(res.status).toBe(200);
    expect(res.body.report.protocol).toBe(protocol);
    expect(res.body.report.status).toBe("RECEIVED");
  });

  it("rejects wrong access code", async () => {
    const res = await request(app)
      .post("/api/ethics-reports/track")
      .send({ protocol, access_code: "WRONGCODE1", organization_id: ORG_ID });
    expect(res.status).toBe(404);
  });

  it("committee lists and replies", async () => {
    const list = await request(app)
      .get("/api/ethics-reports")
      .set("Authorization", `Bearer ${committeeToken}`);
    expect(list.status).toBe(200);
    expect(
      list.body.reports.some((r: { id: string }) => r.id === reportId),
    ).toBe(true);

    const msg = await request(app)
      .post(`/api/ethics-reports/${reportId}/messages`)
      .set("Authorization", `Bearer ${committeeToken}`)
      .send({ body: "Recebemos o relato e vamos analisar." });
    expect(msg.status).toBe(201);
    expect(msg.body.message.side).toBe("COMMITTEE");
    expect(msg.body.message.authorUserId).toBeTruthy();

    const tracked = await request(app)
      .post("/api/ethics-reports/track")
      .send({ protocol, access_code: accessCode, organization_id: ORG_ID });
    expect(tracked.status).toBe(200);
    expect(tracked.body.report.messages.length).toBeGreaterThanOrEqual(1);
    expect(tracked.body.report.messages[0]).not.toHaveProperty("authorUserId");
  });

  it("reporter can reply without identity", async () => {
    const res = await request(app)
      .post("/api/ethics-reports/messages")
      .send({
        protocol,
        access_code: accessCode,
        organization_id: ORG_ID,
        body: "Posso enviar mais detalhes se necessário.",
      });
    expect(res.status).toBe(201);
    expect(res.body.message.side).toBe("REPORTER");
  });

  it("committee resolves with note", async () => {
    const res = await request(app)
      .patch(`/api/ethics-reports/${reportId}`)
      .set("Authorization", `Bearer ${committeeToken}`)
      .send({
        status: "RESOLVED",
        resolution_note: "Medidas administrativas aplicadas.",
      });
    expect(res.status).toBe(200);
    expect(res.body.report.status).toBe("RESOLVED");
    expect(res.body.report.resolvedAt).toBeTruthy();
  });
});
