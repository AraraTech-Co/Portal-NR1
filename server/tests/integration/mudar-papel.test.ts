import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Mudar o papel de quem já foi aprovado. [S1-O]
 *
 * Usa a organização do `scripts/seed-teste-org.ts`. Só muda o papel de
 * usuários criados aqui, para não mexer nos `teste.*` de outros testes.
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

async function entrar(login: string) {
  return request(app).post("/api/auth").send({ login, password: SENHA });
}

async function criarPessoa(nome: string, role: Role = Role.COLABORADOR) {
  const login = `papel.${nome}.${SUFIXO}`;
  const user = await prisma.user.create({
    data: {
      login,
      email: `${login}@teste.local`,
      name: `Pessoa ${nome}`,
      passwordHash: await bcrypt.hash(SENHA, 10),
      mustChangePassword: false,
    },
  });
  criados.push(user.id);
  await prisma.accountMembership.create({
    data: { accountId: ACCOUNT_ID, userId: user.id, role: AccountRole.USER },
  });
  await prisma.membership.create({ data: { userId: user.id, organizationId: ORG_ID, role } });
  return { login, id: user.id };
}

const mudar = (token: string, userId: string, body: Record<string, unknown>) =>
  request(app).patch(`/api/pessoas-acessos/${userId}/papel`).set(as(token)).send(body);

beforeAll(async () => {
  app = createApp();
  owner = (await entrar("teste.owner")).body;
  rh = (await entrar("teste.rh")).body;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: criados } } });
});

describe("mudar o papel depois de aprovado [S1-O]", () => {
  it("o RH promove a supervisor e vale na hora, inclusive na sessão aberta", async () => {
    const p = await criarPessoa("promovida");
    const sessao = (await entrar(p.login)).body.token as string;
    const antes = await request(app).get("/api/auth").set(as(sessao));
    expect(antes.body.user.modules.acoes).toBe("read");

    const res = await mudar(rh.token, p.id, { org_role: "SUPERVISOR" });
    expect(res.status).toBe(200);
    expect(res.body.person.permission).toBe("supervisor");

    const depois = await request(app).get("/api/auth").set(as(sessao));
    expect(depois.body.user.modules.acoes).toBe("write");

    const trilha = await prisma.auditEvent.findFirst({
      where: { action: "membership.role_changed", entityId: p.id },
    });
    expect(trilha?.before).toMatchObject({ orgRole: "COLABORADOR" });
    expect(trilha?.after).toMatchObject({ orgRole: "SUPERVISOR" });
  });

  it("virar fiscal exige prazo; deixar de ser fiscal tira o prazo", async () => {
    const p = await criarPessoa("fiscalizada");
    const daqui5 = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const vira = await mudar(rh.token, p.id, { org_role: "FISCAL", access_until: daqui5 });
    expect(vira.status).toBe(200);
    expect(vira.body.person.permission).toBe("fiscal");
    expect(vira.body.person.access_expires_at).toBeTruthy();

    const volta = await mudar(rh.token, p.id, { org_role: "COLABORADOR" });
    expect(volta.status).toBe(200);
    const m = await prisma.membership.findFirstOrThrow({ where: { userId: p.id, organizationId: ORG_ID } });
    expect(m.role).toBe(Role.COLABORADOR);
    expect(m.accessExpiresAt).toBeNull();
  });

  it("o RH não dá papel do seu nível ou acima, nem mexe em quem está acima", async () => {
    const p = await criarPessoa("limite");
    for (const role of ["RH", "SST", "ADMIN", "MASTER"]) {
      expect((await mudar(rh.token, p.id, { org_role: role })).status, role).toBe(403);
    }
    for (const login of ["teste.owner", "teste.sst", "teste.master"]) {
      const alvo = await prisma.user.findFirstOrThrow({ where: { login } });
      expect((await mudar(rh.token, alvo.id, { org_role: "COLABORADOR" })).status, login).toBe(403);
    }
    expect((await mudar(rh.token, rh.user.id, { org_role: "COLABORADOR" })).status).toBe(400);
  });

  it("o papel na conta segue a mesma regra: o owner dá, o RH não", async () => {
    const p = await criarPessoa("conta");
    expect((await mudar(rh.token, p.id, { org_role: "COLABORADOR", account_role: "ADMIN" })).status).toBe(403);

    const res = await mudar(owner.token, p.id, { org_role: "COLABORADOR", account_role: "ADMIN" });
    expect(res.status).toBe(200);
    // ADMIN da conta vale como ADM loja
    expect(res.body.person.permission).toBe("adm_loja");
  });

  it("quem não cuida de Conta e usuários não muda papel de ninguém", async () => {
    const p = await criarPessoa("protegida");
    for (const login of ["teste.sst", "teste.gerente", "teste.colaborador", "teste.fiscal"]) {
      const token = (await entrar(login)).body.token as string;
      expect((await mudar(token, p.id, { org_role: "SUPERVISOR" })).status, login).toBe(403);
    }
  });

  it("a lista diz para quem o papel pode mudar e quais papéis cada um pode dar", async () => {
    const res = await request(app).get("/api/pessoas-acessos").set(as(rh.token));
    expect(res.body.assignable.org_roles).toContain("FISCAL");
    expect(res.body.assignable.org_roles).not.toContain("RH");
    const self = (res.body.people as { id: string; can_change_role: boolean }[]).find((x) => x.id === rh.user.id);
    expect(self?.can_change_role).toBe(false);
  });
});
