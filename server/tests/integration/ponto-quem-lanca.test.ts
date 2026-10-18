import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O lançamento no Banco de horas é de quem cuida dele. [S5-O]
 *
 * A tela nunca mostrou botão a ninguém, mas a rota ficava em `read` e o
 * colaborador tem leitura no módulo: dava para ele gravar o próprio saldo
 * com o valor que quisesse, por uma requisição direta.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: { token: string; user: { id: string } };
let colaborador: { token: string; user: { id: string } };
let supervisor: { token: string; user: { id: string } };
const dias: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

/** Um dia distinto por caso, para os casos não brigarem pela chave do upsert. */
let proximo = 0;
function diaDeTeste(): string {
  proximo += 1;
  const d = new Date(Date.UTC(2031, 0, proximo));
  const iso = d.toISOString().slice(0, 10);
  dias.push(iso);
  return iso;
}

beforeAll(async () => {
  app = createApp();
  rh = await entrar("teste.rh");
  colaborador = await entrar("teste.colaborador");
  supervisor = await entrar("teste.supervisor");
});

afterAll(async () => {
  await prisma.timeEntry.deleteMany({
    where: {
      organizationId: ORG_ID,
      day: { in: dias.map((d) => new Date(`${d}T00:00:00.000Z`)) },
    },
  });
});

describe("quem lança no Banco de horas [S5-O]", () => {
  it("o colaborador não grava o próprio saldo", async () => {
    const day = diaDeTeste();
    const res = await request(app)
      .post("/api/time-entries")
      .set(as(colaborador.token))
      .send({ day, balance_minutes: 6000, note: "Saldo que eu quis" });

    expect(res.status).toBe(403);

    const gravado = await prisma.timeEntry.findFirst({
      where: {
        organizationId: ORG_ID,
        userId: colaborador.user.id,
        day: new Date(`${day}T00:00:00.000Z`),
      },
    });
    expect(gravado, "nada foi gravado").toBeNull();
  });

  it("nem mandando o próprio user_id", async () => {
    const day = diaDeTeste();
    const res = await request(app)
      .post("/api/time-entries")
      .set(as(colaborador.token))
      .send({ day, user_id: colaborador.user.id, balance_minutes: 480 });
    expect(res.status).toBe(403);
  });

  it("quem só lê o módulo também não lança", async () => {
    const day = diaDeTeste();
    const res = await request(app)
      .post("/api/time-entries")
      .set(as(supervisor.token))
      .send({ day, user_id: colaborador.user.id, balance_minutes: 480 });
    expect(res.status).toBe(403);
  });

  it("o RH lança para a pessoa, e o lançamento sai com o dono certo", async () => {
    const day = diaDeTeste();
    const res = await request(app)
      .post("/api/time-entries")
      .set(as(rh.token))
      .send({
        day,
        user_id: colaborador.user.id,
        balance_minutes: 120,
        note: "Duas horas extras na sexta",
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.entry.userId).toBe(colaborador.user.id);
    expect(res.body.entry.balanceMinutes).toBe(120);
  });

  it("o RH precisa dizer de quem é o lançamento", async () => {
    const day = diaDeTeste();
    const res = await request(app)
      .post("/api/time-entries")
      .set(as(rh.token))
      .send({ day, balance_minutes: 120 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/user_id/);
  });

  it("pessoa de fora da empresa é recusada", async () => {
    const day = diaDeTeste();
    const res = await request(app)
      .post("/api/time-entries")
      .set(as(rh.token))
      .send({
        day,
        user_id: "00000000-0000-4000-8000-00000000dead",
        balance_minutes: 60,
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/[Pp]essoa/);
  });

  it("o colaborador continua consultando o próprio banco de horas", async () => {
    const res = await request(app)
      .get("/api/time-entries")
      .set(as(colaborador.token));
    expect(res.status).toBe(200);
    const meus = res.body.entries as { userId: string }[];
    expect(meus.every((e) => e.userId === colaborador.user.id)).toBe(true);
    expect(meus.some((e) => e.balanceMinutes === 120)).toBe(true);
  });
});
