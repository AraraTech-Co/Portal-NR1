import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import type { Express } from "express";

async function login(app: Express, loginId: string) {
  const res = await request(app)
    .post("/api/auth")
    .send({ login: loginId, password: "admin123" });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

describe("Ideas + Announcements (RH)", () => {
  let app: Express;
  let token: string;
  let ideaId: string;
  let announcementId: string;

  beforeAll(async () => {
    app = createApp();
    token = await login(app, "admin");
  });

  it("creates and decides idea", async () => {
    const created = await request(app)
      .post("/api/ideas")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Protetor auricular cordado",
        description: "Facilitaria o uso contínuo no torno",
      });
    expect(created.status).toBe(201);
    expect(created.body.idea.status).toBe("NEW");
    ideaId = created.body.idea.id;

    const noNote = await request(app)
      .post(`/api/ideas/${ideaId}/decide`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "IMPLEMENTED" });
    expect(noNote.status).toBe(400);

    const decided = await request(app)
      .post(`/api/ideas/${ideaId}/decide`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        status: "IMPLEMENTED",
        decision_note: "Incluído na próxima compra de EPI",
      });
    expect(decided.status).toBe(200);
    expect(decided.body.idea.status).toBe("IMPLEMENTED");
    expect(decided.body.idea.decidedById).toBeTruthy();

    const edit = await request(app)
      .patch(`/api/ideas/${ideaId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "tentativa" });
    expect(edit.status).toBe(409);
  });

  it("publishes announcement and marks read", async () => {
    const created = await request(app)
      .post("/api/announcements")
      .set("Authorization", `Bearer ${token}`)
      .send({
        kind: "TRAINING",
        title: "Capacitação sobre assédio",
        body: "Conteúdo obrigatório Lei 14.457 art. 23",
      });
    expect(created.status).toBe(201);
    expect(created.body.announcement.kind).toBe("TRAINING");
    announcementId = created.body.announcement.id;

    const list = await request(app)
      .get("/api/announcements")
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    const row = list.body.announcements.find(
      (a: { id: string }) => a.id === announcementId,
    );
    expect(row.read_at).toBeNull();

    const read = await request(app)
      .post(`/api/announcements/${announcementId}/read`)
      .set("Authorization", `Bearer ${token}`);
    expect(read.status).toBe(200);

    const again = await request(app)
      .get(`/api/announcements/${announcementId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(again.status).toBe(200);
    expect(again.body.announcement.read_at).toBeTruthy();
  });
});
