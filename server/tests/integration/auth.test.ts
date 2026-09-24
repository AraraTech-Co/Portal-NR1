import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import type { Express } from "express";

const ACCOUNT_FILIAL = "00000000-0000-4000-8000-000000000003";

describe("auth API", () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  it("GET /api/health", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("rejects bad credentials", async () => {
    const res = await request(app)
      .post("/api/auth")
      .send({ login: "admin", password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("OWNER login: only Conta Matriz, permission owner", async () => {
    const res = await request(app)
      .post("/api/auth")
      .send({ login: "admin", password: "admin123" });

    expect(res.status).toBe(200);
    expect(res.body.user.permission).toBe("owner");
    expect(res.body.user.is_master).toBe(false);
    expect(res.body.user.account_role).toBe("OWNER");
    expect(res.body.accounts).toHaveLength(1);
    expect(res.body.accounts[0].name).toBe("Conta Matriz");
  });

  it("OWNER cannot access as-master route", async () => {
    const login = await request(app)
      .post("/api/auth")
      .send({ login: "admin", password: "admin123" });

    const res = await request(app)
      .get("/api/auth/as-master")
      .set("Authorization", `Bearer ${login.body.token}`);

    expect(res.status).toBe(403);
  });

  it("MASTER login: both accounts, permission master", async () => {
    const res = await request(app)
      .post("/api/auth")
      .send({ login: "master", password: "admin123" });

    expect(res.status).toBe(200);
    expect(res.body.user.permission).toBe("master");
    expect(res.body.user.is_master).toBe(true);
    const names = res.body.accounts.map((a: { name: string }) => a.name).sort();
    expect(names).toEqual(["Conta Filial", "Conta Matriz"]);
  });

  it("MASTER can access as-master and switch to Filial", async () => {
    const login = await request(app)
      .post("/api/auth")
      .send({ login: "master", password: "admin123" });

    const asMaster = await request(app)
      .get("/api/auth/as-master")
      .set("Authorization", `Bearer ${login.body.token}`);
    expect(asMaster.status).toBe(200);

    const switched = await request(app)
      .post("/api/auth/switch")
      .set("Authorization", `Bearer ${login.body.token}`)
      .send({ account_id: ACCOUNT_FILIAL });

    expect(switched.status).toBe(200);
    expect(switched.body.user.account.name).toBe("Conta Filial");
    expect(switched.body.user.permission).toBe("master");

    const session = await request(app)
      .get("/api/auth")
      .set("Authorization", `Bearer ${switched.body.token}`);
    expect(session.status).toBe(200);
    expect(session.body.user.account.name).toBe("Conta Filial");
  });

  it("OWNER cannot switch to Conta Filial", async () => {
    const login = await request(app)
      .post("/api/auth")
      .send({ login: "admin", password: "admin123" });

    const switched = await request(app)
      .post("/api/auth/switch")
      .set("Authorization", `Bearer ${login.body.token}`)
      .send({ account_id: ACCOUNT_FILIAL });

    expect(switched.status).toBe(403);
  });

  it("logout revokes token", async () => {
    const login = await request(app)
      .post("/api/auth")
      .send({ login: "admin", password: "admin123" });

    const out = await request(app)
      .delete("/api/auth")
      .set("Authorization", `Bearer ${login.body.token}`);
    expect(out.status).toBe(200);

    const session = await request(app)
      .get("/api/auth")
      .set("Authorization", `Bearer ${login.body.token}`);
    expect(session.status).toBe(401);
  });
});
