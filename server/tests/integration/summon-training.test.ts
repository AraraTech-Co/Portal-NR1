import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import type { Express } from "express";

async function login(app: Express) {
  const res = await request(app)
    .post("/api/auth")
    .send({ login: "admin", password: "admin123" });
  expect(res.status).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

describe("Summons + Trainings", () => {
  let app: Express;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    app = createApp();
    const s = await login(app);
    token = s.token;
    userId = s.user.id;
  });

  it("creates summon, confirms attendance, marks attended", async () => {
    const created = await request(app)
      .post("/api/summons")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "DDS — uso de EPI",
        scheduled_for: "2026-09-30T14:00:00.000Z",
        location: "Refeitório",
        invitee_ids: [userId],
      });
    expect(created.status).toBe(201);
    const id = created.body.summon.id;

    const confirm = await request(app)
      .post(`/api/summons/${id}/attendance`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "CONFIRMED" });
    expect(confirm.status).toBe(200);
    expect(confirm.body.attendance.status).toBe("CONFIRMED");

    const attend = await request(app)
      .post(`/api/summons/${id}/attendance`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "ATTENDED", user_id: userId });
    expect(attend.status).toBe(200);
    expect(attend.body.attendance.status).toBe("ATTENDED");
  });

  it("creates training with quiz and completes enrollment", async () => {
    const created = await request(app)
      .post("/api/trainings")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "NR-12 básica",
        validity_months: 12,
        slides: [{ title: "Intro", body: "Máquinas e proteções" }],
        questions: [
          {
            prompt: "Proteção deve estar instalada?",
            options: ["Sim", "Não"],
            correct_index: 0,
          },
        ],
      });
    expect(created.status).toBe(201);
    const id = created.body.training.id;

    await request(app)
      .post(`/api/trainings/${id}/enroll`)
      .set("Authorization", `Bearer ${token}`);
    await request(app)
      .post(`/api/trainings/${id}/start`)
      .set("Authorization", `Bearer ${token}`);

    const detail = await request(app)
      .get(`/api/trainings/${id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detail.status).toBe(200);
    const qid = detail.body.training.questions[0].id;

    const done = await request(app)
      .post(`/api/trainings/${id}/complete`)
      .set("Authorization", `Bearer ${token}`)
      .send({ answers: [{ question_id: qid, index: 0 }] });
    expect(done.status).toBe(200);
    expect(done.body.enrollment.status).toBe("COMPLETED");
    expect(done.body.enrollment.score).toBe(100);
    expect(done.body.enrollment.certificateCode).toBeTruthy();
    expect(done.body.enrollment.expiresAt).toBeTruthy();
  });
});
