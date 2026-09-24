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

describe("Payslips, certificates, leaves", () => {
  let app: Express;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    app = createApp();
    const session = await login(app);
    token = session.token;
    userId = session.user.id;
  });

  it("publishes payslip and Q&A", async () => {
    const created = await request(app)
      .post("/api/payslips")
      .set("Authorization", `Bearer ${token}`)
      .send({
        user_id: userId,
        reference_month: 9,
        reference_year: 2026,
        file_name: "holerite-09.pdf",
        mime_type: "application/pdf",
      });
    expect([201, 409]).toContain(created.status);
    const payslipId =
      created.status === 201
        ? created.body.payslip.id
        : (
            await request(app)
              .get("/api/payslips?year=2026")
              .set("Authorization", `Bearer ${token}`)
          ).body.payslips.find(
            (p: { referenceMonth: number }) => p.referenceMonth === 9,
          ).id;

    const q = await request(app)
      .post(`/api/payslips/${payslipId}/questions`)
      .set("Authorization", `Bearer ${token}`)
      .send({ body: "Por que o desconto de VT aumentou?" });
    expect(q.status).toBe(201);

    const a = await request(app)
      .post(
        `/api/payslips/${payslipId}/questions/${q.body.question.id}/answer`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({ answer: "Reajuste da tabela municipal." });
    expect(a.status).toBe(200);
    expect(a.body.question.answeredAt).toBeTruthy();
  });

  it("submits and reviews medical certificate", async () => {
    const created = await request(app)
      .post("/api/medical-certificates")
      .set("Authorization", `Bearer ${token}`)
      .send({
        start_date: "2026-09-20",
        days: 2,
        reason: "Gripe",
      });
    expect(created.status).toBe(201);
    const id = created.body.certificate.id;

    const reject = await request(app)
      .post(`/api/medical-certificates/${id}/review`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "REJECTED" });
    expect(reject.status).toBe(400);

    const ok = await request(app)
      .post(`/api/medical-certificates/${id}/review`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "APPROVED" });
    expect(ok.status).toBe(200);
    expect(ok.body.certificate.status).toBe("APPROVED");
  });

  it("requests and decides leave", async () => {
    const created = await request(app)
      .post("/api/leaves")
      .set("Authorization", `Bearer ${token}`)
      .send({
        kind: "VACATION",
        start_date: "2026-12-01",
        end_date: "2026-12-15",
      });
    expect(created.status).toBe(201);
    expect(created.body.leave.days).toBe(15);
    const id = created.body.leave.id;

    const decided = await request(app)
      .post(`/api/leaves/${id}/decide`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "APPROVED" });
    expect(decided.status).toBe(200);
    expect(decided.body.leave.status).toBe("APPROVED");
  });
});
