import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import { holerite } from "../helpers/pdf";

/**
 * Privacidade do atestado e conferência do holerite. [S4-A] [S4-J] [S5-G]
 *
 * Exige a organização do `scripts/seed-teste-org.ts` (um usuário por papel).
 */
const SENHA = "teste1234";

async function entrar(app: Express, login: string, password = SENHA) {
  const res = await request(app).post("/api/auth").send({ login, password });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string; name: string } };
}

let app: Express;
let colaborador: { token: string; user: { id: string; name: string } };
let rh: { token: string; user: { id: string; name: string } };

beforeAll(async () => {
  app = createApp();
  colaborador = await entrar(app, "teste.colaborador");
  rh = await entrar(app, "teste.rh");
});

async function enviarAtestado(token: string, reason: string) {
  const res = await request(app)
    .post("/api/medical-certificates")
    .set("Authorization", `Bearer ${token}`)
    .send({ start_date: "2026-10-05", days: 1, reason });
  expect(res.status).toBe(201);
  return res.body.certificate.id as string;
}

describe("atestado é assunto do trabalhador com o RH [S4-A]", () => {
  it("o colaborador recebe só o próprio atestado, nunca o do colega", async () => {
    await enviarAtestado(rh.token, "Consulta do RH");
    await enviarAtestado(colaborador.token, "Consulta do colaborador");

    const lista = await request(app)
      .get("/api/medical-certificates")
      .set("Authorization", `Bearer ${colaborador.token}`);
    expect(lista.status).toBe(200);

    const donos = (lista.body.certificates as { user: { id: string } }[]).map(
      (c) => c.user.id,
    );
    expect(donos.length).toBeGreaterThan(0);
    expect([...new Set(donos)]).toEqual([colaborador.user.id]);
  });

  it("o RH continua vendo os de todo mundo — é o trabalho dele", async () => {
    const lista = await request(app)
      .get("/api/medical-certificates")
      .set("Authorization", `Bearer ${rh.token}`);
    expect(lista.status).toBe(200);
    const donos = new Set(
      (lista.body.certificates as { user: { id: string } }[]).map((c) => c.user.id),
    );
    expect(donos.has(colaborador.user.id)).toBe(true);
  });
});

describe("quem envia não decide [S4-J]", () => {
  it("o colaborador não aprova atestado nenhum, nem o próprio", async () => {
    const id = await enviarAtestado(colaborador.token, "Para tentar aprovar");
    const res = await request(app)
      .post(`/api/medical-certificates/${id}/review`)
      .set("Authorization", `Bearer ${colaborador.token}`)
      .send({ status: "APPROVED" });
    expect(res.status).toBe(403);
  });

  it("nem o RH decide sobre o próprio atestado", async () => {
    const id = await enviarAtestado(rh.token, "Atestado do próprio RH");
    const res = await request(app)
      .post(`/api/medical-certificates/${id}/review`)
      .set("Authorization", `Bearer ${rh.token}`)
      .send({ status: "APPROVED" });
    expect(res.status).toBe(403);
  });

  it("o RH decide sobre o do colaborador", async () => {
    const id = await enviarAtestado(colaborador.token, "Para o RH decidir");
    const res = await request(app)
      .post(`/api/medical-certificates/${id}/review`)
      .set("Authorization", `Bearer ${rh.token}`)
      .send({ status: "APPROVED" });
    expect(res.status).toBe(200);
    expect(res.body.certificate.status).toBe("APPROVED");
  });
});

describe("o holerite é conferido no documento [S5-G]", () => {
  const competencia = { reference_month: 10, reference_year: 2026 };

  it("recusa o documento de outra pessoa", async () => {
    const res = await request(app)
      .post("/api/payslips")
      .set("Authorization", `Bearer ${rh.token}`)
      .send({
        user_id: colaborador.user.id,
        ...competencia,
        file_name: "holerite-10.pdf",
        mime_type: "application/pdf",
        content_base64: holerite("RH-001", rh.user.name, "OUTUBRO/2026"),
      });
    expect(res.status).toBe(422);
    expect(String(res.body.reasons?.join(" "))).toMatch(/matrícula do documento/i);
  });

  it("recusa competência diferente da escolhida", async () => {
    const res = await request(app)
      .post("/api/payslips")
      .set("Authorization", `Bearer ${rh.token}`)
      .send({
        user_id: colaborador.user.id,
        ...competencia,
        file_name: "holerite-09.pdf",
        mime_type: "application/pdf",
        content_base64: holerite("COL-001", colaborador.user.name, "SETEMBRO/2026"),
      });
    expect(res.status).toBe(422);
    expect(String(res.body.reasons?.join(" "))).toMatch(/competência/i);
  });

  it("recusa PDF sem texto (digitalizado)", async () => {
    const res = await request(app)
      .post("/api/payslips")
      .set("Authorization", `Bearer ${rh.token}`)
      .send({
        user_id: colaborador.user.id,
        ...competencia,
        file_name: "scan.pdf",
        mime_type: "application/pdf",
        content_base64: Buffer.from([1, 2, 3, 4, 5]).toString("base64"),
      });
    expect(res.status).toBe(422);
    expect(String(res.body.reasons?.join(" "))).toMatch(/digitalizado/i);
  });

  it("publica quando matrícula, nome e competência batem", async () => {
    const res = await request(app)
      .post("/api/payslips")
      .set("Authorization", `Bearer ${rh.token}`)
      .send({
        user_id: colaborador.user.id,
        ...competencia,
        file_name: "holerite-10.pdf",
        mime_type: "application/pdf",
        content_base64: holerite("COL-001", colaborador.user.name, "OUTUBRO/2026"),
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.payslip.userId).toBe(colaborador.user.id);
  });
});
