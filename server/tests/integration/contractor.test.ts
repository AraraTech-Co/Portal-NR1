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

describe("Contractor module (NR-1 1.5.8)", () => {
  let app: Express;
  let token: string;
  let contractorId: string;

  beforeAll(async () => {
    app = createApp();
    token = await login(app, "admin");
  });

  it("rejects invalid relation", async () => {
    const res = await request(app)
      .post("/api/contractors")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Fornecedor X", relation: "PARTNER" });
    expect(res.status).toBe(400);
  });

  it("creates WE_HIRE contractor", async () => {
    const res = await request(app)
      .post("/api/contractors")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Manutenção Industrial Sul",
        tax_id: "12.345.678/0001-90",
        relation: "WE_HIRE",
        establishment_id: EST_ID,
        services_scope: "Manutenção de máquinas na usinagem",
      });
    expect(res.status).toBe(201);
    expect(res.body.contractor.relation).toBe("WE_HIRE");
    expect(res.body.contractor.documentsReceivedAt).toBeNull();
    contractorId = res.body.contractor.id;
  });

  it("marks documents received (1.5.8.1.1)", async () => {
    const res = await request(app)
      .post(`/api/contractors/${contractorId}/documents-received`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        notes: "Inventário e plano de ação 2026 recebidos em PDF",
      });
    expect(res.status).toBe(200);
    expect(res.body.contractor.documentsReceivedAt).toBeTruthy();
    expect(res.body.contractor.documentsNotes).toContain("Inventário");
  });

  it("marks risks informed with interaction measures (1.5.8.2–4)", async () => {
    const res = await request(app)
      .post(`/api/contractors/${contractorId}/risks-informed`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        interaction_measures:
          "Coordenação diária no briefing; área isolada durante solda",
      });
    expect(res.status).toBe(200);
    expect(res.body.contractor.risksInformedAt).toBeTruthy();
    expect(res.body.contractor.interactionMeasures).toContain("briefing");
  });

  it("lists, updates and archives", async () => {
    const list = await request(app)
      .get("/api/contractors")
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(
      list.body.contractors.some((c: { id: string }) => c.id === contractorId),
    ).toBe(true);

    const patch = await request(app)
      .patch(`/api/contractors/${contractorId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ services_scope: "Manutenção + calibração" });
    expect(patch.status).toBe(200);
    expect(patch.body.contractor.servicesScope).toContain("calibração");

    const del = await request(app)
      .delete(`/api/contractors/${contractorId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(del.body.contractor.archivedAt).toBeTruthy();

    const listActive = await request(app)
      .get("/api/contractors")
      .set("Authorization", `Bearer ${token}`);
    expect(
      listActive.body.contractors.some(
        (c: { id: string }) => c.id === contractorId,
      ),
    ).toBe(false);
  });
});
