import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * "O que o fiscal consultou", legível.
 *
 * A lista dava uma linha por requisição — 147 numa sessão, 35 delas como
 * "Outra consulta", com o endereço interno embaixo, sem a entrada do fiscal
 * no portal e sem filtro por dia nem por pessoa. [B2-4-H]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
/** Um dia só deste teste, para não misturar com o resto do banco local. */
const DIA = "2026-03-17";

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let master: string;
let fiscalId = "";
let riscoId = "";
let riscoDescricao = "";
const eventos: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

/** Uma linha na trilha, como o portal grava quando o fiscal abre uma tela. */
async function registrar(path: string, hora: string, action = "consulta.view") {
  const row = await prisma.auditEvent.create({
    data: {
      organizationId: ORG_ID,
      actorId: fiscalId,
      action,
      entityType: "Consulta",
      entityId: path,
      createdAt: new Date(`${DIA}T${hora}-03:00`),
    },
    select: { id: true },
  });
  eventos.push(row.id);
}

beforeAll(async () => {
  app = createApp();
  master = (await entrar("teste.master")).token;
  fiscalId = (await entrar("teste.fiscal")).user.id;

  const risco = await prisma.risk.findFirst({
    where: { hazard: { organizationId: ORG_ID } },
    select: { id: true, description: true },
  });
  expect(risco, "um risco no seed").toBeTruthy();
  riscoId = risco!.id;
  riscoDescricao = risco!.description;

  await registrar("/api/auth", "09:00:00", "session.signin");
  await registrar("/api/notificacoes", "09:00:01");
  await registrar("/api/fiscalizacao", "09:00:02");
  await registrar("/api/fiscalizacao", "09:00:40");
  await registrar("/api/fiscalizacao", "09:01:10");
  await registrar("/api/establishments", "09:01:11");
  await registrar("/api/inventory", "09:02:00");
  await registrar(`/api/risks/${riscoId}`, "09:03:00");
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { id: { in: eventos } } });
});

async function consultar(qs: string) {
  const res = await request(app)
    .get(`/api/consulta-acessos${qs}`)
    .set(as(master));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as {
    acessos: Array<{
      kind: string;
      screen: string;
      record: string | null;
      times: number;
      user: { id: string } | null;
    }>;
    day: string | null;
    days: string[];
  };
}

describe("uma linha por tela, com nome [B2-4-H]", () => {
  it("o dia escolhido traz só o dia escolhido", async () => {
    const data = await consultar(`?day=${DIA}`);
    expect(data.day).toBe(DIA);
    expect(data.acessos.length).toBeGreaterThan(0);
    expect(data.days).toContain(DIA);
  });

  it("as consultas que a tela faz sozinha ficam de fora", async () => {
    const data = await consultar(`?day=${DIA}&user_id=${fiscalId}`);
    const telas = data.acessos.map((a) => a.screen);
    expect(telas).not.toContain("Consulta de apoio da tela");

    // E voltam quando se pede.
    const comApoio = await consultar(`?day=${DIA}&user_id=${fiscalId}&tudo=true`);
    expect(comApoio.acessos.map((a) => a.screen)).toContain(
      "Consulta de apoio da tela",
    );
    expect(comApoio.acessos.length).toBeGreaterThan(data.acessos.length);
  });

  it("abrir a mesma tela três vezes é uma linha, com a contagem", async () => {
    const data = await consultar(`?day=${DIA}&user_id=${fiscalId}`);
    const painel = data.acessos.filter(
      (a) => a.screen === "Painel da fiscalização",
    );
    expect(painel).toHaveLength(1);
    expect(painel[0]!.times).toBe(3);
  });

  it("a entrada no portal aparece", async () => {
    const data = await consultar(`?day=${DIA}&user_id=${fiscalId}`);
    const entrada = data.acessos.filter((a) => a.kind === "entrada");
    expect(entrada).toHaveLength(1);
    expect(entrada[0]!.screen).toBe("Entrou no portal");
  });

  it("o registro aberto aparece pelo nome, não pelo identificador", async () => {
    const data = await consultar(`?day=${DIA}&user_id=${fiscalId}`);
    const umRisco = data.acessos.find((a) => a.screen === "Inventário — um risco");
    expect(umRisco, "a linha do risco aberto").toBeTruthy();
    expect(umRisco!.record).toBe(riscoDescricao);
    /*
      O identificador continua no campo `path`, para o modo que mostra tudo;
      o que a tela lê — nome da tela e do registro — não o carrega.
    */
    expect(`${umRisco!.screen} ${umRisco!.record}`).not.toContain(riscoId);
  });

  it("o filtro por pessoa só traz aquela pessoa", async () => {
    const data = await consultar(`?day=${DIA}&user_id=${fiscalId}`);
    expect(data.acessos.length).toBeGreaterThan(0);
    for (const a of data.acessos) expect(a.user?.id).toBe(fiscalId);

    const deOutro = await consultar(
      `?day=${DIA}&user_id=00000000-0000-4000-8000-00000000dead`,
    );
    expect(deOutro.acessos).toEqual([]);
  });

  it("dia inválido é recusado", async () => {
    const res = await request(app)
      .get("/api/consulta-acessos?day=ontem")
      .set(as(master));
    expect(res.status).toBe(400);
  });

  it("quem não cuida da conta não lê a lista", async () => {
    const sst = (await entrar("teste.sst")).token;
    const res = await request(app).get("/api/consulta-acessos").set(as(sst));
    expect(res.status).toBe(403);
  });
});
