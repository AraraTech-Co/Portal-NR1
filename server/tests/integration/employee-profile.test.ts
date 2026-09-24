import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import type { Express } from "express";

const JOB_ID = "00000000-0000-4000-8000-000000000012";

async function login(app: Express, loginId: string) {
  const res = await request(app)
    .post("/api/auth")
    .send({ login: loginId, password: "admin123" });
  expect(res.status).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

describe("Employee profiles (RH)", () => {
  let app: Express;
  let token: string;
  let userId: string;
  let profileId: string;

  beforeAll(async () => {
    app = createApp();
    const session = await login(app, "admin");
    token = session.token;
    userId = session.user.id;
  });

  it("creates profile with normalized CPF", async () => {
    const res = await request(app)
      .post("/api/employee-profiles")
      .set("Authorization", `Bearer ${token}`)
      .send({
        user_id: userId,
        registration: "MAT-001",
        tax_id: "123.456.789-09",
        phone: "11999990000",
        job_role_id: JOB_ID,
        admitted_at: "2024-01-15",
      });

    if (res.status === 409) {
      const me = await request(app)
        .get("/api/employee-profiles/me")
        .set("Authorization", `Bearer ${token}`);
      expect(me.status).toBe(200);
      profileId = me.body.profile.id;
      // Reativa se estava demitido
      await request(app)
        .patch(`/api/employee-profiles/${profileId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          dismissed_at: null,
          tax_id: "123.456.789-09",
          registration: "MAT-001",
          job_role_id: JOB_ID,
        });
      return;
    }

    expect(res.status).toBe(201);
    expect(res.body.profile.taxId).toBe("12345678909");
    expect(res.body.profile.registration).toBe("MAT-001");
    expect(res.body.profile.jobRoleId).toBe(JOB_ID);
    profileId = res.body.profile.id;
  });

  it("rejects duplicate profile for same user", async () => {
    const res = await request(app)
      .post("/api/employee-profiles")
      .set("Authorization", `Bearer ${token}`)
      .send({ user_id: userId, registration: "MAT-002" });
    expect(res.status).toBe(409);
  });

  it("rejects invalid tax_id length", async () => {
    // use master to create another profile attempt with bad tax — need different user
    const master = await login(app, "master");
    const res = await request(app)
      .post("/api/employee-profiles")
      .set("Authorization", `Bearer ${master.token}`)
      .send({
        user_id: master.user.id,
        tax_id: "12345",
      });
    expect(res.status).toBe(400);
  });

  it("gets me and lists", async () => {
    const me = await request(app)
      .get("/api/employee-profiles/me")
      .set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.profile.id).toBe(profileId);

    const list = await request(app)
      .get("/api/employee-profiles")
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.profiles.length).toBeGreaterThanOrEqual(1);
  });

  it("updates and dismisses", async () => {
    const patch = await request(app)
      .patch(`/api/employee-profiles/${profileId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ phone: "11888887777" });
    expect(patch.status).toBe(200);
    expect(patch.body.profile.phone).toBe("11888887777");

    const del = await request(app)
      .delete(`/api/employee-profiles/${profileId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(del.body.profile.dismissedAt).toBeTruthy();
  });
});
