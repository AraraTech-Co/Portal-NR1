import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import type { Express } from "express";
import prisma from "../../src/model/prisma";
import { holerite } from "../helpers/pdf";

const ORG_ID = "00000000-0000-4000-8000-000000000001";

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
  let fichaCriada = "";
  let fichaAntes: { id: string; registration: string | null; dismissedAt: Date | null } | null = null;

  beforeAll(async () => {
    app = createApp();
    const session = await login(app);
    token = session.token;
    userId = session.user.id;
    /*
      A conferência do holerite procura a matrícula no cadastro. O seed não
      cria a ficha do admin: ela vinha do teste da ficha, quando ele rodava
      antes. O teste garante a própria ficha e devolve como achou. [C2-9]
    */
    const ficha = await prisma.employeeProfile.findUnique({
      where: { organizationId_userId: { organizationId: ORG_ID, userId } },
      select: { id: true, registration: true, dismissedAt: true },
    });
    if (!ficha) {
      fichaCriada = (
        await prisma.employeeProfile.create({
          data: { organizationId: ORG_ID, userId, registration: "MAT-001" },
        })
      ).id;
    } else if (ficha.registration !== "MAT-001" || ficha.dismissedAt) {
      fichaAntes = ficha;
      await prisma.employeeProfile.update({
        where: { id: ficha.id },
        data: { registration: "MAT-001", dismissedAt: null },
      });
    }
  });

  afterAll(async () => {
    if (fichaCriada) await prisma.employeeProfile.deleteMany({ where: { id: fichaCriada } });
    if (fichaAntes) {
      await prisma.employeeProfile.update({
        where: { id: fichaAntes.id },
        data: { registration: fichaAntes.registration, dismissedAt: fichaAntes.dismissedAt },
      });
    }
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
        // O documento é conferido contra o cadastro: precisa ser da pessoa.
        content_base64: holerite("MAT-001", "Owner Conta Matriz", "SETEMBRO/2026"),
      });
    expect([200, 201]).toContain(created.status);
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

    // Quem enviou não decide sobre o próprio atestado. [S4-J]
    const self = await request(app)
      .post(`/api/medical-certificates/${id}/review`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "APPROVED" });
    expect(self.status).toBe(403);

    // Outra pessoa com poder de decisão revisa.
    const reviewer = await request(app)
      .post("/api/auth")
      .send({ login: "master", password: "admin123" });
    expect(reviewer.status).toBe(200);
    const reviewerToken = reviewer.body.token as string;

    const reject = await request(app)
      .post(`/api/medical-certificates/${id}/review`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({ status: "REJECTED" });
    expect(reject.status).toBe(400);

    const ok = await request(app)
      .post(`/api/medical-certificates/${id}/review`)
      .set("Authorization", `Bearer ${reviewerToken}`)
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
