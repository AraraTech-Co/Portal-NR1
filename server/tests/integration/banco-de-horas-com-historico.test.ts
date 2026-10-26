import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Cada movimento do banco de horas é um lançamento, com autor e trilha.
 *
 * O banco guardava UM lançamento por pessoa e por dia: lançar de novo no
 * mesmo dia substituía as horas e o motivo do anterior, sem aviso e sem
 * guardar o que havia. Uma hora extra de manhã e outra à tarde, ou uma
 * correção, apagavam o movimento anterior. O lançamento também não
 * registrava quem o fez nem entrava no histórico de auditoria: numa
 * reclamação trabalhista não havia como mostrar quem lançou nem o que havia
 * antes. A decisão S5-M fala em cada movimento com histórico. [CB-66] [S5-M]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
const DIA = "2027-04-15";

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: { token: string; user: { id: string } };
let colaborador: { token: string; user: { id: string } };
const lancamentos: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

async function lancar(minutos: number, motivo: string) {
  const res = await request(app)
    .post("/api/time-entries")
    .set(as(rh.token))
    .send({
      user_id: colaborador.user.id,
      day: DIA,
      balance_minutes: minutos,
      note: `${motivo} ${SUFIXO}`,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  lancamentos.push(res.body.entry.id);
  return res.body.entry as { id: string; createdBy: { id: string; name: string } | null };
}

/** Os lançamentos deste teste, como o colaborador os vê. */
async function meusLancamentos() {
  const res = await request(app)
    .get("/api/time-entries")
    .set(as(colaborador.token));
  expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
  return (res.body.entries as {
    id: string;
    balanceMinutes: number;
    note: string | null;
    createdBy: { name: string } | null;
  }[]).filter((e) => lancamentos.includes(e.id));
}

beforeAll(async () => {
  app = createApp();
  rh = await entrar("teste.rh");
  colaborador = await entrar("teste.colaborador");
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: lancamentos } } });
  await prisma.timeEntry.deleteMany({ where: { id: { in: lancamentos } } });
});

describe("dois movimentos no mesmo dia convivem [CB-66] [S5-M]", () => {
  it("o segundo lançamento não apaga o primeiro", async () => {
    const manha = await lancar(60, "Hora extra da manhã");
    const tarde = await lancar(90, "Hora extra da tarde");
    expect(manha.id).not.toBe(tarde.id);

    const meus = await meusLancamentos();
    /*
      É o defeito do achado: o segundo substituía o primeiro, e a hora da
      manhã sumia sem aviso.
    */
    expect(meus.length, "os dois ficam").toBe(2);
    expect(meus.map((e) => e.balanceMinutes).sort((a, b) => a - b)).toEqual([60, 90]);
    expect(
      meus.map((e) => e.note).join(" "),
      "o motivo de cada um se mantém",
    ).toContain("Hora extra da manhã");
  });

  it("o saldo é a soma dos movimentos, não o último", async () => {
    const meus = await meusLancamentos();
    const saldo = meus.reduce((t, e) => t + e.balanceMinutes, 0);
    expect(saldo).toBe(150);
  });

  it("uma correção negativa entra como movimento, sem apagar nada", async () => {
    await lancar(-30, "Correção: meia hora a menos");
    const meus = await meusLancamentos();
    expect(meus.length).toBe(3);
    expect(meus.reduce((t, e) => t + e.balanceMinutes, 0)).toBe(120);
  });
});

describe("o lançamento tem autor e trilha [CB-66]", () => {
  it("quem lançou fica gravado e aparece para quem consulta", async () => {
    const entry = await lancar(15, "Com autor");
    expect(entry.createdBy?.id, "o autor vem na resposta").toBe(rh.user.id);

    const meus = await meusLancamentos();
    const esse = meus.find((e) => e.id === entry.id);
    expect(esse!.createdBy?.name, "o colaborador vê quem lançou").toBeTruthy();
  });

  it("o lançamento entra no histórico de auditoria", async () => {
    const entry = await lancar(20, "Para a trilha");
    const fatos = await prisma.auditEvent.findMany({
      where: { organizationId: ORG_ID, entityId: entry.id },
      select: { action: true, actorId: true },
    });
    expect(fatos.map((f) => f.action)).toContain("time_entry.create");
    expect(fatos[0]!.actorId).toBe(rh.user.id);
  });

  it("o colaborador continua sem lançar para si [S5-O]", async () => {
    const res = await request(app)
      .post("/api/time-entries")
      .set(as(colaborador.token))
      .send({ user_id: colaborador.user.id, day: DIA, balance_minutes: 480 });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });
});
