import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { resolveAccessUntil } from "../../src/helper/access-period";

/**
 * O fiscal entra com prazo e perde o acesso sozinho no fim dele. [S7-A]
 *
 * Usa a organização do `scripts/seed-teste-org.ts`. Cria fiscais próprios
 * para não mexer no `teste.fiscal`, que outros testes usam em paralelo.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const ACCOUNT_ID = "aaaaaaaa-0001-4000-8000-000000000002";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let owner: string;
const criados: string[] = [];

async function entrar(login: string) {
  return request(app).post("/api/auth").send({ login, password: SENHA });
}

/** Fiscal direto no banco, com o prazo pedido. */
async function criarFiscal(nome: string, accessExpiresAt: Date | null) {
  const login = `fiscal.${nome}.${SUFIXO}`;
  const user = await prisma.user.create({
    data: {
      login,
      email: `${login}@teste.local`,
      name: `Fiscal ${nome}`,
      passwordHash: await bcrypt.hash(SENHA, 10),
      mustChangePassword: false,
    },
  });
  criados.push(user.id);
  await prisma.accountMembership.create({
    data: { accountId: ACCOUNT_ID, userId: user.id, role: AccountRole.USER },
  });
  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId: ORG_ID, role: Role.FISCAL, accessExpiresAt },
  });
  return { login, userId: user.id, membershipId: membership.id };
}

beforeAll(async () => {
  app = createApp();
  const res = await entrar("teste.owner");
  expect(res.status).toBe(200);
  owner = res.body.token;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: criados } } });
});

describe("data-limite do acesso", () => {
  const agora = new Date("2026-10-09T15:00:00-03:00");

  it("sem data, 30 dias; a data vale até o fim do dia em Brasília", () => {
    expect(resolveAccessUntil(undefined, agora).toISOString()).toBe("2026-11-09T02:59:59.999Z");
    expect(resolveAccessUntil("2026-10-20", agora).toISOString()).toBe("2026-10-21T02:59:59.999Z");
  });

  it("recusa data que já passou, mais de um ano e formato errado", () => {
    expect(() => resolveAccessUntil("2026-10-08", agora)).toThrow(/já passou/);
    expect(() => resolveAccessUntil("2027-10-10", agora)).toThrow(/um ano/);
    expect(() => resolveAccessUntil("20/10/2026", agora)).toThrow(/inválida/);
  });
});

describe("o acesso cai no fim do prazo", () => {
  it("prazo vencido: o login explica por quê", async () => {
    const vencido = await criarFiscal("vencido", new Date(Date.now() - 60_000));
    const res = await entrar(vencido.login);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCESS_ENDED");
    expect(res.body.message).toMatch(/Seu acesso terminou em/);
  });

  it("encerrar agora derruba a sessão aberta; renovar devolve o acesso", async () => {
    const f = await criarFiscal("ativo", new Date(Date.now() + 7 * 86_400_000));
    const login = await entrar(f.login);
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    expect((await request(app).get("/api/inventory").set(as(token))).status).toBe(200);

    const fim = await request(app)
      .patch(`/api/fiscais/${f.membershipId}`)
      .set(as(owner))
      .send({ end_now: true });
    expect(fim.status).toBe(200);
    expect(fim.body.fiscal.active).toBe(false);

    // A mesma sessão, aberta antes, já não serve.
    expect((await request(app).get("/api/inventory").set(as(token))).status).toBe(401);
    expect((await entrar(f.login)).body.code).toBe("ACCESS_ENDED");

    const amanha = new Date(Date.now() + 86_400_000 - 3 * 3_600_000).toISOString().slice(0, 10);
    const renova = await request(app)
      .patch(`/api/fiscais/${f.membershipId}`)
      .set(as(owner))
      .send({ access_until: amanha });
    expect(renova.status).toBe(200);
    expect(renova.body.fiscal.active).toBe(true);
    expect((await entrar(f.login)).status).toBe(200);
  });

  it("a lista de fiscais mostra até quando cada um tem acesso", async () => {
    const f = await criarFiscal("listado", new Date(Date.now() + 86_400_000));
    const res = await request(app).get("/api/fiscais").set(as(owner));
    expect(res.status).toBe(200);
    const row = (res.body.fiscais as { id: string; active: boolean; access_expires_at: string }[]).find(
      (x) => x.id === f.membershipId,
    );
    expect(row?.active).toBe(true);
    expect(row?.access_expires_at).toBeTruthy();
  });

  it("só quem cuida de Conta e usuários mexe no prazo", async () => {
    const f = await criarFiscal("protegido", new Date(Date.now() + 86_400_000));
    const sst = (await entrar("teste.sst")).body.token as string;
    const fiscal = (await entrar(f.login)).body.token as string;
    for (const token of [sst, fiscal]) {
      const res = await request(app)
        .patch(`/api/fiscais/${f.membershipId}`)
        .set(as(token))
        .send({ access_until: "2030-01-01" });
      expect(res.status).toBe(403);
    }
  });
});

describe("aprovar alguém como fiscal", () => {
  it("entra com prazo e não vira ficha de colaborador", async () => {
    const email = `fiscal.pedido.${SUFIXO}@teste.local`;
    const pedido = await prisma.accountJoinRequest.create({
      data: {
        accountId: ACCOUNT_ID,
        name: "Fiscal do Pedido",
        email,
        passwordHash: await bcrypt.hash(SENHA, 10),
        isExternal: true,
      },
    });
    const daqui10 = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const res = await request(app)
      .post(`/api/join-requests/${pedido.id}/decide`)
      .set(as(owner))
      .send({ action: "approve", role: "USER", org_role: "FISCAL", access_until: daqui10 });
    expect(res.status).toBe(200);
    expect(res.body.access_expires_at).toBeTruthy();

    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    criados.push(user.id);
    const membership = await prisma.membership.findFirstOrThrow({
      where: { userId: user.id, organizationId: ORG_ID },
    });
    expect(membership.role).toBe(Role.FISCAL);
    expect(membership.accessExpiresAt?.toISOString().slice(0, 10)).toBe(
      new Date(`${daqui10}T23:59:59.999-03:00`).toISOString().slice(0, 10),
    );
    const ficha = await prisma.employeeProfile.findFirst({ where: { userId: user.id } });
    expect(ficha).toBeNull();
  });

  it("data inválida não aprova", async () => {
    const pedido = await prisma.accountJoinRequest.create({
      data: {
        accountId: ACCOUNT_ID,
        name: "Fiscal Errado",
        email: `fiscal.errado.${SUFIXO}@teste.local`,
        passwordHash: await bcrypt.hash(SENHA, 10),
        isExternal: true,
      },
    });
    const res = await request(app)
      .post(`/api/join-requests/${pedido.id}/decide`)
      .set(as(owner))
      .send({ action: "approve", role: "USER", org_role: "FISCAL", access_until: "2020-01-01" });
    expect(res.status).toBe(400);
    await prisma.accountJoinRequest.delete({ where: { id: pedido.id } });
  });
});
