import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O que o trabalhador pede e o RH decide.
 *
 * O atestado passa a caber em horas, para a declaração de comparecimento não
 * virar um dia de falta [S5-C]; o pedido de férias diz a quem decide se há
 * direito [S5-D]; e o lançamento de horas tem dia e motivo [S5-M].
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: { token: string; user: { id: string } };
let colaborador: { token: string; user: { id: string } };
const criados: string[] = [];
const pedidos: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

/** Pessoa com data de admissão escolhida, para o direito a férias. */
async function pessoaAdmitidaEm(nome: string, admissao: Date | null) {
  const login = `ferias.${nome}.${SUFIXO}`;
  const user = await prisma.user.create({
    data: {
      login,
      email: `${login}@teste.local`,
      name: `Pessoa ${nome} ${SUFIXO}`,
      passwordHash: await bcrypt.hash(SENHA, 10),
      mustChangePassword: false,
    },
  });
  criados.push(user.id);
  await prisma.membership.create({
    data: { userId: user.id, organizationId: ORG_ID, role: Role.COLABORADOR },
  });
  await prisma.accountMembership.create({
    data: {
      accountId: "aaaaaaaa-0001-4000-8000-000000000002",
      userId: user.id,
      role: "USER",
    },
  });
  await prisma.employeeProfile.create({
    data: { organizationId: ORG_ID, userId: user.id, admittedAt: admissao },
  });
  return { login, userId: user.id };
}

beforeAll(async () => {
  app = createApp();
  rh = await entrar("teste.rh");
  colaborador = await entrar("teste.colaborador");
});

afterAll(async () => {
  await prisma.leaveRequest.deleteMany({ where: { id: { in: pedidos } } });
  await prisma.timeEntry.deleteMany({ where: { userId: { in: criados } } });
  await prisma.user.deleteMany({ where: { id: { in: criados } } });
});

describe("o atestado cabe em horas [S5-C]", () => {
  it("duas horas de comparecimento não viram um dia de falta", async () => {
    const res = await request(app)
      .post("/api/medical-certificates")
      .set(as(colaborador.token))
      .send({
        start_date: "2026-10-14",
        hours: 2,
        reason: `Consulta ${SUFIXO}`,
        file_name: "declaracao.png",
        mime_type: "image/png",
        content_base64: Buffer.from(`decl ${SUFIXO}`).toString("base64"),
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const guardado = await prisma.medicalCertificate.findFirstOrThrow({
      where: { id: res.body.certificate.id },
      select: { days: true, hours: true },
    });
    expect(guardado.hours).toBe(2);
    expect(guardado.days, "não conta como dia de afastamento").toBe(0);
  });

  it("o atestado em dias continua como era", async () => {
    const res = await request(app)
      .post("/api/medical-certificates")
      .set(as(colaborador.token))
      .send({
        start_date: "2026-10-15",
        days: 3,
        file_name: "atestado.png",
        mime_type: "image/png",
        content_base64: Buffer.from(`at ${SUFIXO}`).toString("base64"),
      });
    expect(res.status).toBe(201);

    const guardado = await prisma.medicalCertificate.findFirstOrThrow({
      where: { id: res.body.certificate.id },
      select: { days: true, hours: true },
    });
    expect(guardado.days).toBe(3);
    expect(guardado.hours).toBeNull();
  });

  it("mais de 24 horas é recusado, porque aí são dias", async () => {
    const res = await request(app)
      .post("/api/medical-certificates")
      .set(as(colaborador.token))
      .send({
        start_date: "2026-10-16",
        hours: 30,
        file_name: "x.png",
        mime_type: "image/png",
        content_base64: Buffer.from("x").toString("base64"),
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/24 horas/);
  });

  it("sem dias e sem horas, não entra", async () => {
    const res = await request(app)
      .post("/api/medical-certificates")
      .set(as(colaborador.token))
      .send({ start_date: "2026-10-17" });
    expect(res.status).toBe(400);
  });
});

describe("o pedido de férias diz se há direito [S5-D]", () => {
  async function pedir(token: string, inicio: string, fim: string, nota?: string) {
    const res = await request(app)
      .post("/api/leaves")
      .set(as(token))
      .send({ kind: "VACATION", start_date: inicio, end_date: fim, note: nota });
    if (res.status === 201) pedidos.push(res.body.leave.id);
    return res;
  }

  it("quem tem 12 meses de casa aparece com direito; quem não tem, com a data", async () => {
    const antigo = await pessoaAdmitidaEm(
      "antigo",
      new Date("2020-01-10T00:00:00.000Z"),
    );
    const novo = await pessoaAdmitidaEm(
      "novo",
      new Date(Date.now() - 30 * 86_400_000),
    );

    const sessaoAntigo = await entrar(antigo.login);
    const sessaoNovo = await entrar(novo.login);
    expect((await pedir(sessaoAntigo.token, "2027-02-01", "2027-02-10")).status).toBe(201);
    expect((await pedir(sessaoNovo.token, "2027-03-01", "2027-03-10")).status).toBe(201);

    const lista = await request(app).get("/api/leaves").set(as(rh.token));
    expect(lista.status).toBe(200);
    const linhas = lista.body.leaves as {
      userId: string;
      vacation_right: { entitled: boolean; complete_at: string | null } | null;
    }[];

    const doAntigo = linhas.find((l) => l.userId === antigo.userId);
    expect(doAntigo?.vacation_right?.entitled, "12 meses completos").toBe(true);

    const doNovo = linhas.find((l) => l.userId === novo.userId);
    expect(doNovo?.vacation_right?.entitled).toBe(false);
    expect(doNovo?.vacation_right?.complete_at, "a tela diz quando fecha").toBeTruthy();
  });

  it("sem admissão na ficha, o direito fica em aberto e não trava o pedido", async () => {
    const sem = await pessoaAdmitidaEm("semadmissao", null);
    const sessao = await entrar(sem.login);
    expect((await pedir(sessao.token, "2027-04-01", "2027-04-05")).status).toBe(201);

    const lista = await request(app).get("/api/leaves").set(as(rh.token));
    const linha = (lista.body.leaves as { userId: string; vacation_right: { entitled: boolean; complete_at: string | null } | null }[]).find(
      (l) => l.userId === sem.userId,
    );
    expect(linha?.vacation_right?.entitled).toBe(false);
    expect(linha?.vacation_right?.complete_at).toBeNull();
  });

  it("o RH decide, e o que a pessoa escreveu continua lá", async () => {
    const p = await pessoaAdmitidaEm("decide", new Date("2019-05-05T00:00:00.000Z"));
    const sessao = await entrar(p.login);
    const pedido = await pedir(
      sessao.token,
      "2027-05-01",
      "2027-05-10",
      "Viagem marcada com a família.",
    );
    expect(pedido.status).toBe(201);

    const decisao = await request(app)
      .post(`/api/leaves/${pedido.body.leave.id}/decide`)
      .set(as(rh.token))
      .send({ status: "APPROVED", decision_note: "Combinado com a chefia." });
    expect(decisao.status, JSON.stringify(decisao.body)).toBe(200);

    const lista = await request(app).get("/api/leaves").set(as(rh.token));
    const linha = (lista.body.leaves as { id: string; note: string | null; decisionNote: string | null; status: string }[]).find(
      (l) => l.id === pedido.body.leave.id,
    );
    expect(linha?.status).toBe("APPROVED");
    expect(linha?.note, "o que a pessoa escreveu").toMatch(/família/);
    expect(linha?.decisionNote).toMatch(/chefia/);
  });

  it("recusar sem motivo é recusado", async () => {
    const p = await pessoaAdmitidaEm("semmotivo", new Date("2019-05-05T00:00:00.000Z"));
    const sessao = await entrar(p.login);
    const pedido = await pedir(sessao.token, "2027-06-01", "2027-06-05");

    const res = await request(app)
      .post(`/api/leaves/${pedido.body.leave.id}/decide`)
      .set(as(rh.token))
      .send({ status: "REJECTED" });
    expect(res.status).toBe(400);
  });
});

describe("o lançamento de horas tem dia e motivo [S5-M]", () => {
  it("o RH lança crédito e débito, e o colaborador vê o seu", async () => {
    const p = await pessoaAdmitidaEm("horas", new Date("2020-01-01T00:00:00.000Z"));

    const credito = await request(app)
      .post("/api/time-entries")
      .set(as(rh.token))
      .send({
        user_id: p.userId,
        day: "2026-10-20",
        balance_minutes: 120,
        note: "Hora extra na parada de máquina",
      });
    expect(credito.status, JSON.stringify(credito.body)).toBe(201);

    const debito = await request(app)
      .post("/api/time-entries")
      .set(as(rh.token))
      .send({
        user_id: p.userId,
        day: "2026-10-21",
        balance_minutes: -60,
        note: "Saída antecipada",
      });
    expect(debito.status).toBe(201);

    const sessao = await entrar(p.login);
    const meus = await request(app).get("/api/time-entries").set(as(sessao.token));
    expect(meus.status).toBe(200);
    const linhas = meus.body.entries as { balanceMinutes: number; note: string }[];
    expect(linhas.length).toBe(2);
    expect(linhas.every((l) => l.note), "cada lançamento diz de onde veio").toBe(true);
    expect(linhas.reduce((t, l) => t + l.balanceMinutes, 0)).toBe(60);
  });

  it("o RH consegue olhar o de uma pessoa específica", async () => {
    const p = await pessoaAdmitidaEm("filtro", new Date("2020-01-01T00:00:00.000Z"));
    await request(app)
      .post("/api/time-entries")
      .set(as(rh.token))
      .send({
        user_id: p.userId,
        day: "2026-10-22",
        balance_minutes: 30,
        note: "Meia hora de treinamento",
      });

    const res = await request(app)
      .get(`/api/time-entries?user_id=${p.userId}`)
      .set(as(rh.token));
    expect(res.status).toBe(200);
    const linhas = res.body.entries as { userId: string }[];
    expect(linhas.length).toBeGreaterThan(0);
    expect(linhas.every((l) => l.userId === p.userId)).toBe(true);
  });
});
