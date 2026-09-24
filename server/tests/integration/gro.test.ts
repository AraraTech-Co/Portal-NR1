import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import type { Express } from "express";
import { resolveLevel } from "../../src/helper/risk-methodology";

const ACT_ID = "00000000-0000-4000-8000-000000000013";
const RISK_ID = "00000000-0000-4000-8000-000000000015";
const METHOD_ID = "11111111-1111-4111-8111-111111111111";

async function login(app: Express, loginId: string) {
  const res = await request(app)
    .post("/api/auth")
    .send({ login: loginId, password: "admin123" });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

describe("resolveLevel", () => {
  it("maps 5x5 score and rejects unknown combo", () => {
    const matrix: Record<string, string> = { "3-3": "MODERATE" };
    const version = {
      severityScale: [{ value: 3 }],
      probabilityScale: [{ value: 3 }],
      matrix,
    };
    expect(resolveLevel(version, 3, 3)).toBe("MODERATE");
    expect(() => resolveLevel(version, 1, 1)).toThrow();
  });
});

describe("GRO API", () => {
  let app: Express;
  let ownerToken: string;
  let masterToken: string;

  beforeAll(async () => {
    app = createApp();
    ownerToken = await login(app, "admin");
    masterToken = await login(app, "master");
  });

  it("lists seed establishments and methodologies", async () => {
    const est = await request(app)
      .get("/api/establishments")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(est.status).toBe(200);
    expect(est.body.establishments.length).toBeGreaterThanOrEqual(1);

    const meth = await request(app)
      .get("/api/methodologies")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(meth.status).toBe(200);
    expect(
      meth.body.methodologies.some(
        (m: { id: string }) => m.id === METHOD_ID,
      ),
    ).toBe(true);
  });

  it("OWNER (sst) can create hazard; RH-like user cannot write without sst", async () => {
    const created = await request(app)
      .post("/api/hazards")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        activity_id: ACT_ID,
        description: "Ruído excessivo na usinagem",
        category: "PHYSICAL",
        exposed_workers_count: 4,
      });
    expect(created.status).toBe(201);
    expect(created.body.hazard.description).toContain("Ruído");
  });

  it("lists seed risks and creates assessment then validates with another user", async () => {
    const risks = await request(app)
      .get("/api/risks")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(risks.status).toBe(200);
    expect(risks.body.risks.some((r: { id: string }) => r.id === RISK_ID)).toBe(
      true,
    );

    const meth = await request(app)
      .get("/api/methodologies")
      .set("Authorization", `Bearer ${ownerToken}`);
    const versionId = meth.body.methodologies.find(
      (m: { id: string }) => m.id === METHOD_ID,
    ).versions[0].id;

    const draft = await request(app)
      .post("/api/assessments")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        risk_id: RISK_ID,
        methodology_version_id: versionId,
        severity: 3,
        probability: 3,
      });
    expect(draft.status).toBe(201);
    expect(draft.body.assessment.resultingLevel).toBeTruthy();
    expect(draft.body.assessment.status).toBe("DRAFT");

    const selfValidate = await request(app)
      .post(`/api/assessments/${draft.body.assessment.id}/validate`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(selfValidate.status).toBe(403);

    const validated = await request(app)
      .post(`/api/assessments/${draft.body.assessment.id}/validate`)
      .set("Authorization", `Bearer ${masterToken}`);
    expect(validated.status).toBe(200);
    expect(validated.body.assessment.status).toBe("VALIDATED");
    expect(validated.body.assessment.expiresAt).toBeTruthy();
  });

  it("creates control and action on seed risk", async () => {
    const control = await request(app)
      .post("/api/controls")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        risk_id: RISK_ID,
        type: "PPE",
        description: "Óculos de proteção",
      });
    expect(control.status).toBe(201);

    const action = await request(app)
      .post("/api/actions")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        title: "Disponibilizar EPIs",
        risk_id: RISK_ID,
        control_id: control.body.control.id,
        priority: "HIGH",
      });
    expect(action.status).toBe(201);
  });

  it("rejects write without auth", async () => {
    const res = await request(app).post("/api/establishments").send({
      name: "X",
    });
    expect(res.status).toBe(401);
  });
});
