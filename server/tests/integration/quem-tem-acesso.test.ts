import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Quem tem acesso, quem perdeu e por quê.
 *
 * Desligado, suspenso e prazo vencido deixam de parecer a mesma coisa
 * [CB-39]; tirar o acesso de quem continua na empresa deixa de exigir um
 * desligamento inventado [CB-44]; quem foi desligado antes da atualização
 * para de entrar [CB-9]; e a lista diz a situação de cada um [S6-C].
 *
 * Usa a organização do `scripts/seed-teste-org.ts`, com gente criada aqui.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const ACCOUNT_ID = "aaaaaaaa-0001-4000-8000-000000000002";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let owner: { token: string; user: { id: string } };
let rh: { token: string; user: { id: string } };
const criados: string[] = [];

const entrar = (login: string) =>
  request(app).post("/api/auth").send({ login, password: SENHA });

async function novaPessoa(nome: string, role: Role = Role.COLABORADOR) {
  const login = `acesso.${nome}.${SUFIXO}`;
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
  await prisma.accountMembership.create({
    data: { accountId: ACCOUNT_ID, userId: user.id, role: AccountRole.USER },
  });
  await prisma.membership.create({
    data: { userId: user.id, organizationId: ORG_ID, role },
  });
  const profile = await prisma.employeeProfile.create({
    data: {
      organizationId: ORG_ID,
      userId: user.id,
      registration: `ACE-${nome}-${SUFIXO}`.slice(0, 20),
      admittedAt: new Date("2025-01-06T00:00:00.000Z"),
    },
  });
  return { login, userId: user.id, profileId: profile.id };
}

const pessoas = async (token: string) => {
  const res = await request(app).get("/api/pessoas-acessos").set(as(token));
  expect(res.status).toBe(200);
  return res.body.people as {
    id: string;
    status: string;
    status_since: string | null;
    status_by: string | null;
    can_suspend: boolean;
  }[];
};

const acesso = (token: string, userId: string, suspend: boolean) =>
  request(app)
    .post(`/api/pessoas-acessos/${userId}/acesso`)
    .set(as(token))
    .send({ suspend });

beforeAll(async () => {
  app = createApp();
  owner = (await entrar("teste.owner")).body;
  rh = (await entrar("teste.rh")).body;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: criados } } });
});

describe("suspender não é desligar [CB-44]", () => {
  it("o acesso cai na hora e volta sem passar por desligamento", async () => {
    const p = await novaPessoa("ana");
    const sessao = (await entrar(p.login)).body.token as string;
    expect((await request(app).get("/api/auth").set(as(sessao))).status).toBe(200);

    const corte = await acesso(rh.token, p.userId, true);
    expect(corte.status).toBe(200);
    expect(corte.body.suspended).toBe(true);

    // Sessão aberta não sobrevive, e a entrada é recusada dizendo o que é.
    expect((await request(app).get("/api/auth").set(as(sessao))).status).toBe(401);
    const tentativa = await entrar(p.login);
    expect(tentativa.status).toBe(403);
    expect(tentativa.body.code).toBe("ACCESS_SUSPENDED");
    expect(tentativa.body.message).toMatch(/suspenso/i);

    // A ficha continua dizendo que a pessoa trabalha aqui.
    const ficha = await request(app)
      .get(`/api/employee-profiles/${p.profileId}/ficha`)
      .set(as(rh.token));
    expect(ficha.body.profile.dismissedAt, "suspender não inventa saída").toBeNull();

    const volta = await acesso(rh.token, p.userId, false);
    expect(volta.status).toBe(200);
    expect((await entrar(p.login)).status).toBe(200);
  });

  it("ninguém suspende o próprio acesso nem o de quem está acima", async () => {
    expect((await acesso(rh.token, rh.user.id, true)).status).toBe(400);

    const p = await novaPessoa("chefe", Role.MASTER);
    const res = await acesso(rh.token, p.userId, true);
    expect(res.status).toBe(403);
  });

  it("quem foi desligado volta pela ficha, não por aqui", async () => {
    const p = await novaPessoa("bruno");
    await request(app)
      .post(`/api/employee-profiles/${p.profileId}/desligamento`)
      .set(as(rh.token))
      .send({ reason: "Fim de contrato" });

    const res = await acesso(rh.token, p.userId, false);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/reverta o desligamento/i);
  });
});

describe("cada perda de acesso diz o que é [CB-39] [S6-C]", () => {
  it("desligado, suspenso e prazo vencido aparecem diferentes na lista", async () => {
    const desligado = await novaPessoa("carla");
    await request(app)
      .post(`/api/employee-profiles/${desligado.profileId}/desligamento`)
      .set(as(rh.token))
      .send({ reason: "Pedido de demissão" });

    const suspenso = await novaPessoa("davi");
    await acesso(rh.token, suspenso.userId, true);

    const vencido = await novaPessoa("eva", Role.FISCAL);
    await prisma.membership.updateMany({
      where: { userId: vencido.userId, organizationId: ORG_ID },
      data: { accessExpiresAt: new Date(Date.now() - 86_400_000) },
    });

    const lista = await pessoas(owner.token);
    const por = (id: string) => lista.find((x) => x.id === id);

    expect(por(desligado.userId)?.status).toBe("dismissed");
    expect(por(desligado.userId)?.status_by, "quem registrou aparece").toBeTruthy();
    expect(por(suspenso.userId)?.status).toBe("suspended");
    expect(por(vencido.userId)?.status).toBe("expired");

    // E quem foi desligado não tem botão de devolver acesso por aqui.
    expect(por(desligado.userId)?.can_suspend).toBe(false);
    expect(por(suspenso.userId)?.can_suspend).toBe(true);
  });

  it("a recusa de entrada do desligado não fala em renovar", async () => {
    const p = await novaPessoa("fabio");
    await request(app)
      .post(`/api/employee-profiles/${p.profileId}/desligamento`)
      .set(as(rh.token))
      .send({});
    const res = await entrar(p.login);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCESS_DISMISSED");
    expect(res.body.message).toMatch(/v[íi]nculo/i);
    expect(res.body.message).not.toMatch(/renovar/i);
  });
});

describe("quem foi desligado antes da atualização [CB-9]", () => {
  it("perde o acesso pela suspensão gravada na migração", async () => {
    const p = await novaPessoa("gustavo");
    // Estado anterior à correção: ficha desligada, acesso intacto.
    await prisma.employeeProfile.update({
      where: { id: p.profileId },
      data: { dismissedAt: new Date("2026-09-01T00:00:00.000Z") },
    });
    expect((await entrar(p.login)).status, "antes da suspensão, entrava").toBe(200);

    // É o que a migração faz com os desligados antigos.
    await prisma.membership.updateMany({
      where: { userId: p.userId, organizationId: ORG_ID },
      data: { suspendedAt: new Date("2026-09-01T00:00:00.000Z"), suspensionReason: "DISMISSAL" },
    });

    const res = await entrar(p.login);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCESS_DISMISSED");
    expect((await pessoas(owner.token)).find((x) => x.id === p.userId)?.status).toBe(
      "dismissed",
    );
  });
});

describe("o convite não entrega a conta sem querer [B2-1-A] [CB-17]", () => {
  it("a matrícula repetida não conta quais matrículas existem", async () => {
    const link = await request(app)
      .post("/api/invite-links")
      .set(as(owner.token))
      .send({ label: `Teste ${SUFIXO}`, role_mode: "ON_APPROVE" });
    expect(link.status).toBe(201);

    const existente = await prisma.employeeProfile.findFirst({
      where: { organizationId: ORG_ID, registration: { not: null } },
      select: { registration: true },
    });
    expect(existente?.registration).toBeTruthy();

    const res = await request(app)
      .post(`/api/invites/${link.body.link.token}`)
      .send({
        name: `Intruso ${SUFIXO}`,
        email: `intruso.${SUFIXO}@teste.local`,
        password: "umaSenhaQualquer1",
        registration: existente!.registration,
      });
    expect(res.status).toBe(409);
    expect(
      res.body.message,
      "a mensagem não confirma que a matrícula existe",
    ).not.toMatch(/já está em uso/i);
    expect(res.body.message).toMatch(/Fale com o RH/i);
  });
});
