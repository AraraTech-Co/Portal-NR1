import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import type { Express } from "express";

async function login(app: Express) {
  const res = await request(app)
    .post("/api/auth")
    .send({ login: "admin", password: "admin123" });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

describe("HR documents", () => {
  let app: Express;
  let token: string;
  let docId: string;

  beforeAll(async () => {
    app = createApp();
    token = await login(app);
  });

  it("publishes document requiring ack and acknowledges", async () => {
    const created = await request(app)
      .post("/api/hr-documents")
      .set("Authorization", `Bearer ${token}`)
      .send({
        kind: "TERM",
        title: "Termo de ciência — política de assédio",
        requires_ack: true,
        file_name: "termo.pdf",
        mime_type: "application/pdf",
      });
    expect(created.status).toBe(201);
    expect(created.body.document.requiresAck).toBe(true);
    docId = created.body.document.id;

    const ack = await request(app)
      .post(`/api/hr-documents/${docId}/ack`)
      .set("Authorization", `Bearer ${token}`);
    expect(ack.status).toBe(200);
    expect(ack.body.ack.acknowledgedAt).toBeTruthy();

    const list = await request(app)
      .get("/api/hr-documents")
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    const row = list.body.documents.find((d: { id: string }) => d.id === docId);
    expect(row.my_ack.acknowledgedAt).toBeTruthy();
  });
});
