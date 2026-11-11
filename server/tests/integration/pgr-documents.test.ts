import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import type { Express } from "express";
import { REQUIRED_PGR_DOCUMENTS } from "../../src/helper/compliance";
import prisma from "../../src/model/prisma";

const RISK_ID = "00000000-0000-4000-8000-000000000015";
const EST_ID = "00000000-0000-4000-8000-000000000010";
const ORG_ID = "00000000-0000-4000-8000-000000000001";

async function login(app: Express, loginId: string) {
  const res = await request(app)
    .post("/api/auth")
    .send({ login: loginId, password: "admin123" });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

describe("compliance constants", () => {
  /*
    A NR-1 pede dois documentos (1.5.7.1); os critérios são conteúdo do
    inventário (1.5.7.3.2 "f"). [B3-4-J]
  */
  it("requires the two PGR documents", () => {
    expect([...REQUIRED_PGR_DOCUMENTS]).toEqual(["INVENTORY", "ACTION_PLAN"]);
  });
});

describe("PGR documents + inventory + change events", () => {
  let app: Express;
  let token: string;

  /*
    O plano de ação não é emitido vazio: o teste abre a própria ação no
    risco do seed. Num banco novo, o seed não tem ação, e o teste dependia
    do que outros arquivos deixavam para trás.
  */
  let acaoDoTeste = "";

  beforeAll(async () => {
    app = createApp();
    token = await login(app, "admin");
    const admin = await prisma.user.findUniqueOrThrow({ where: { login: "admin" }, select: { id: true } });
    acaoDoTeste = (
      await prisma.action.create({
        data: {
          organizationId: ORG_ID,
          title: `Ação do teste de documentos ${Date.now().toString(36)}`,
          sourceType: "RISK",
          riskId: RISK_ID,
          assigneeId: admin.id,
          createdById: admin.id,
          dueDate: new Date(Date.now() + 7 * 24 * 3600_000),
          effectivenessCriteria: "Conferido na próxima inspeção.",
        },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    if (acaoDoTeste) await prisma.action.deleteMany({ where: { id: acaoDoTeste } });
  });

  it("returns live inventory projection", async () => {
    const res = await request(app)
      .get("/api/inventory")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.inventory.items.length).toBeGreaterThanOrEqual(1);
    expect(res.body.inventory.items[0]).toHaveProperty("exposed_workers_count");
  });

  it("issues INVENTORY and ACTION_PLAN as append-only versions", async () => {
    for (const type of REQUIRED_PGR_DOCUMENTS) {
      const issued = await request(app)
        .post("/api/pgr-documents")
        .set("Authorization", `Bearer ${token}`)
        .send({
          type,
          establishment_id: EST_ID,
          responsible_name: "Eng. Responsável Demo",
          responsible_role: "SESMT",
        });
      expect(issued.status).toBe(201);
      expect(issued.body.document.type).toBe(type);
      expect(issued.body.document.version).toBeGreaterThanOrEqual(1);
      expect(issued.body.document.content).toBeTruthy();
      expect(issued.body.document.signatureStatement).toBeTruthy();
    }

    const list = await request(app)
      .get("/api/pgr-documents")
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.required_types).toEqual([...REQUIRED_PGR_DOCUMENTS]);
    expect(list.body.documents.length).toBeGreaterThanOrEqual(2);

    const again = await request(app)
      .post("/api/pgr-documents")
      .set("Authorization", `Bearer ${token}`)
      .send({
        type: "INVENTORY",
        establishment_id: EST_ID,
        responsible_name: "Eng. Responsável Demo",
      });
    expect(again.status).toBe(201);
    expect(again.body.document.version).toBeGreaterThanOrEqual(2);
  });

  it("creates change event and can flag risks for reassessment", async () => {
    const res = await request(app)
      .post("/api/change-events")
      .set("Authorization", `Bearer ${token}`)
      .send({
        type: "PROCESS_CHANGE",
        description: "Nova linha de usinagem",
        establishment_id: EST_ID,
        flag_risk_ids: [RISK_ID],
      });
    expect(res.status).toBe(201);

    const risks = await request(app)
      .get("/api/risks")
      .set("Authorization", `Bearer ${token}`);
    const risk = risks.body.risks.find((r: { id: string }) => r.id === RISK_ID);
    expect(risk.needsReassessment).toBe(true);
  });
});
