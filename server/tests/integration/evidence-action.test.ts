import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import type { Express } from "express";
import {
  assertAllowedMime,
  assertSize,
  MAX_EVIDENCE_BYTES,
} from "../../src/helper/uploads";

const RISK_ID = "00000000-0000-4000-8000-000000000015";

async function login(app: Express, loginId: string) {
  const res = await request(app)
    .post("/api/auth")
    .send({ login: loginId, password: "admin123" });
  expect(res.status).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

/** Ação exige dono e prazo (NR-1 1.5.5.2). [S2-M] */
const PRAZO = "2026-12-31";

describe("uploads helpers", () => {
  it("allows only safe mime types", () => {
    expect(assertAllowedMime("application/pdf")).toBe(".pdf");
    expect(() => assertAllowedMime("application/x-msdownload")).toThrow();
  });

  it("enforces 20MB cap", () => {
    expect(() => assertSize(MAX_EVIDENCE_BYTES + 1)).toThrow();
    assertSize(0);
  });
});

describe("Evidence + Action workflow", () => {
  let app: Express;
  let ownerToken: string;
  let masterToken: string;
  let ownerId: string;

  beforeAll(async () => {
    app = createApp();
    const owner = await login(app, "admin");
    const master = await login(app, "master");
    ownerToken = owner.token;
    masterToken = master.token;
    ownerId = owner.user.id;
  });

  it("complete without evidence fails; with evidence goes to waiting validation", async () => {
    const action = await request(app)
      .post("/api/actions")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        title: "Instalar protetor",
        risk_id: RISK_ID,
        priority: "HIGH",
        assignee_id: ownerId,
        due_date: PRAZO,
      });
    expect(action.status).toBe(201);
    const actionId = action.body.action.id as string;

    const noEv = await request(app)
      .post(`/api/actions/${actionId}/complete`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(noEv.status).toBe(400);

    const ev = await request(app)
      .post("/api/evidences")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        action_id: actionId,
        file_name: "foto.jpg",
        mime_type: "image/jpeg",
        description: "Protetor instalado",
        content_base64: Buffer.from("fake-image").toString("base64"),
      });
    expect(ev.status).toBe(201);
    // O caminho no disco é interno; o arquivo sai por /api/evidences/:id/file. [S3-L]
    expect(ev.body.evidence.storagePath).toBeUndefined();
    const file = await request(app)
      .get(`/api/evidences/${ev.body.evidence.id}/file`)
      .set("Authorization", `Bearer ${masterToken}`);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("image/jpeg");

    const done = await request(app)
      .post(`/api/actions/${actionId}/complete`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(done.status).toBe(200);
    expect(done.body.action.status).toBe("WAITING_VALIDATION");

    const selfReview = await request(app)
      .post(`/api/actions/${actionId}/review`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ decision: "approve" });
    expect(selfReview.status).toBe(403);

    const control = await request(app)
      .post("/api/controls")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        risk_id: RISK_ID,
        type: "ENGINEERING",
        description: "Protetor de acrílico",
      });
    expect(control.status).toBe(201);

    // Link control by creating a fresh flow with control_id
    const action2 = await request(app)
      .post("/api/actions")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        title: "Validar protetor",
        risk_id: RISK_ID,
        control_id: control.body.control.id,
        assignee_id: ownerId,
        due_date: PRAZO,
      });
    const id2 = action2.body.action.id as string;
    await request(app)
      .post("/api/evidences")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        action_id: id2,
        file_name: "check.pdf",
        mime_type: "application/pdf",
        content_base64: Buffer.from("%PDF").toString("base64"),
      });
    await request(app)
      .post(`/api/actions/${id2}/complete`)
      .set("Authorization", `Bearer ${ownerToken}`);

    const approved = await request(app)
      .post(`/api/actions/${id2}/review`)
      .set("Authorization", `Bearer ${masterToken}`)
      .send({
        decision: "approve",
        effectiveness_result: "Protetor eficaz",
        flag_reassessment: true,
        reassessment_reason: "Risco residual",
      });
    expect(approved.status).toBe(200);
    expect(approved.body.action.status).toBe("VALIDATED");

    const controls = await request(app)
      .get(`/api/controls?risk_id=${RISK_ID}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    const updated = controls.body.controls.find(
      (c: { id: string }) => c.id === control.body.control.id,
    );
    expect(updated.status).toBe("IMPLEMENTED");

    const risks = await request(app)
      .get("/api/risks")
      .set("Authorization", `Bearer ${ownerToken}`);
    const risk = risks.body.risks.find((r: { id: string }) => r.id === RISK_ID);
    expect(risk.needsReassessment).toBe(true);
  });

  it("reject returns action to in_progress and requires reason", async () => {
    const action = await request(app)
      .post("/api/actions")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: "Rejeitar depois", risk_id: RISK_ID, assignee_id: ownerId, due_date: PRAZO });
    const id = action.body.action.id as string;
    await request(app)
      .post("/api/evidences")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        action_id: id,
        file_name: "a.png",
        mime_type: "image/png",
      });
    await request(app)
      .post(`/api/actions/${id}/complete`)
      .set("Authorization", `Bearer ${ownerToken}`);

    const noReason = await request(app)
      .post(`/api/actions/${id}/review`)
      .set("Authorization", `Bearer ${masterToken}`)
      .send({ decision: "reject" });
    expect(noReason.status).toBe(400);

    const rejected = await request(app)
      .post(`/api/actions/${id}/review`)
      .set("Authorization", `Bearer ${masterToken}`)
      .send({ decision: "reject", rejection_reason: "Foto ilegível" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.action.status).toBe("IN_PROGRESS");
  });
});
