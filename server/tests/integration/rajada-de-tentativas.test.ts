import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O limite de 5 erros vale também contra rajada. [C1-7]
 *
 * A tentativa é reservada no banco ANTES de conferir: numa rajada
 * simultânea, só as 5 primeiras chegam à conferência (a ficha, no primeiro
 * acesso; o bcrypt, no login). Conferir antes e contar depois deixava todas
 * passarem pela trava, e a certa no meio da rajada recebia a ficha.
 *
 * O que se mede é quantas conferências aconteceram de fato, contando as
 * chamadas no próprio processo do servidor (o supertest sobe o app aqui).
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
const RAJADA = 30;

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

/* A filial vem primeiro na entrada e no primeiro acesso. [C3-2b] */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
let FILIAL = "";

let app: Express;
let rh: { token: string };

function cpfFicticio(semente: number): string {
  const base = String(100000000 + (semente % 800000000));
  const d = base.split("").map(Number);
  const v = (t: number) => {
    const soma = d.slice(0, t).reduce((acc, x, i) => acc + x * (t + 1 - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  d.push(v(9));
  d.push(v(10));
  return `${base}${d[9]}${d[10]}`;
}

async function pessoaNova(n: number) {
  const matricula = `RJ${n}${SUFIXO}`.toUpperCase().slice(0, 18);
  const cpf = cpfFicticio(Date.now() + n * 104729);
  const res = await request(app)
    .post("/api/pessoas-acessos/importar")
    .set(as(rh.token))
    .send({
      people: [
        {
          name: `Rajada Pessoa ${n} ${SUFIXO}`,
          registration: matricula,
          tax_id: cpf,
          birth_date: "1990-03-15",
          establishment_id: FILIAL,
        },
      ],
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect(res.body.results[0].status).toBe("created");
  const user = await prisma.user.findUniqueOrThrow({ where: { login: res.body.results[0].login } });
  return { matricula, cpf, login: res.body.results[0].login as string, userId: user.id };
}

beforeAll(async () => {
  process.env.LOGIN_ORG_ID = ORG_ID;
  FILIAL = (
    await prisma.establishment.create({ data: { organizationId: ORG_ID, name: `Filial rajada ${SUFIXO}` } })
  ).id;
  app = createApp();
  const res = await request(app).post("/api/auth").send({ login: "teste.rh", password: SENHA });
  expect(res.status).toBe(200);
  rh = res.body;
});

/*
  Os espiões repassam a chamada à função original e ficam até o fim do
  arquivo: restaurar o do Prisma desmonta o método (ele não é uma função
  comum, é um delegado). O do bcrypt é restaurado no próprio teste.
*/

afterAll(async () => {
  await prisma.user.deleteMany({ where: { name: { contains: "Rajada Pessoa" } } });
  await prisma.authLockout.deleteMany({});
  await prisma.establishment.delete({ where: { id: FILIAL } });
  delete process.env.LOGIN_ORG_ID;
});

describe("rajada simultânea [C1-7]", () => {
  it("primeiro acesso: 30 ao mesmo tempo, só 5 conferem a ficha, e a certa no fim não recebe ficha", async () => {
    const p = await pessoaNova(1);
    /* Conta as consultas da ficha, chamando a original de verdade. */
    const consultaOriginal = prisma.employeeProfile.findMany.bind(prisma.employeeProfile);
    const conferencias = vi
      .spyOn(prisma.employeeProfile, "findMany")
      .mockImplementation(((args: never) => consultaOriginal(args)) as never);

    // Canário: a contagem enxerga a conferência do servidor.
    const canario = await request(app)
      .post("/api/auth/primeiro-acesso")
      .send({ matricula: p.matricula, cpf: p.cpf, nascimento: "1901-01-01", establishment_id: FILIAL });
    expect(canario.status, "o canário chega à recusa normal").toBe(400);
    expect(conferencias.mock.calls.length, "a contagem vê a conferência").toBe(1);
    await prisma.authLockout.deleteMany({});
    conferencias.mockClear();

    const datas = Array.from({ length: RAJADA - 1 }, (_, i) => `19${50 + i}-01-01`).concat(["1990-03-15"]);
    const respostas = await Promise.all(
      datas.map((nascimento) =>
        request(app).post("/api/auth/primeiro-acesso").send({ matricula: p.matricula, cpf: p.cpf, nascimento, establishment_id: FILIAL }),
      ),
    );

    expect(conferencias.mock.calls.length, "conferências na rajada").toBeLessThanOrEqual(5);
    expect(respostas.filter((r) => r.status === 500).length, "nenhum erro interno").toBe(0);
    // A certa só leva ficha se estiver entre as 5 primeiras a chegar.
    const comFicha = respostas.filter((r) => r.body?.token).length;
    expect(comFicha).toBeLessThanOrEqual(1);
    expect(await prisma.activationToken.count({ where: { userId: p.userId } })).toBe(comFicha);
  });

  it("login: 30 senhas ao mesmo tempo na mesma conta, só 5 chegam ao bcrypt", async () => {
    const p = await pessoaNova(2);
    await prisma.user.update({
      where: { id: p.userId },
      data: { passwordHash: await bcrypt.hash(["senha", "rajada", SUFIXO].join("-"), 4), activatedAt: new Date() },
    });
    /* Conta as comparações de senha, chamando a original de verdade. */
    const compararOriginal = bcrypt.compare.bind(bcrypt);
    const comparacoes = vi
      .spyOn(bcrypt, "compare")
      .mockImplementation(((senha: string, hash: string) => compararOriginal(senha, hash)) as never);

    // Canário: a contagem enxerga o bcrypt do servidor.
    const canario = await request(app).post("/api/auth").send({ login: p.login, password: "errada-canario" });
    expect(canario.status, "o canário chega à recusa normal").toBe(401);
    expect(comparacoes.mock.calls.length, "a contagem vê o bcrypt").toBe(1);
    await prisma.authLockout.deleteMany({});
    comparacoes.mockClear();

    const respostas = await Promise.all(
      Array.from({ length: RAJADA }, (_, i) =>
        request(app)
          .post("/api/auth")
          .send({ login: i % 2 ? p.cpf : p.matricula, password: `errada-${i}`, establishment_id: FILIAL }),
      ),
    );
    expect(comparacoes.mock.calls.length, "bcrypt na rajada").toBeLessThanOrEqual(5);
    expect(respostas.filter((r) => r.status === 500).length, "nenhum erro interno").toBe(0);
    expect(respostas.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(RAJADA - 5);
    comparacoes.mockRestore();
  });

  it("acerto no meio da rajada não derruba o servidor (a linha some e ninguém estoura)", async () => {
    const p = await pessoaNova(3);
    const senha = ["senha", "meio", SUFIXO].join("-");
    await prisma.user.update({
      where: { id: p.userId },
      data: { passwordHash: await bcrypt.hash(senha, 4), activatedAt: new Date() },
    });
    const respostas = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        request(app).post("/api/auth").send({ login: p.login, password: i === 2 ? senha : `errada-${i}` }),
      ),
    );
    expect(respostas.filter((r) => r.status === 500).length).toBe(0);
  });

  it("contagem no teto sem trava (tentativas que nunca terminaram) vira bloqueio com prazo, não recusa eterna", async () => {
    const p = await pessoaNova(4);
    const chave = `acct:${p.userId}`;
    // Cinco tentativas reservadas cujo processo caiu: contagem no teto, sem bloqueio gravado.
    await prisma.authLockout.create({ data: { key: chave, failures: 5, lockedUntil: null } });

    const recusada = await request(app).post("/api/auth").send({ login: p.login, password: "qualquer" });
    expect(recusada.status).toBe(429);
    const linha = await prisma.authLockout.findUniqueOrThrow({ where: { key: chave } });
    expect(linha.lockedUntil, "a recusa grava um bloqueio que vence").not.toBeNull();

    // Vencido o bloqueio, a conta volta a ser conferida.
    await prisma.authLockout.update({ where: { key: chave }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    const depois = await request(app).post("/api/auth").send({ login: p.login, password: "qualquer" });
    expect(depois.status).toBe(401);
  });
});
