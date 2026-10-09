import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Quem é quem e o que cada um acessa [S1-B]; redefinir a senha de outra
 * pessoa [S1-D].
 *
 * Usa a organização do `scripts/seed-teste-org.ts`. A senha é redefinida só
 * em usuários criados aqui, para não mexer nos `teste.*` de outros testes.
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

async function entrar(login: string, password = SENHA) {
  return request(app).post("/api/auth").send({ login, password });
}

async function criarPessoa(nome: string, role: Role) {
  const login = `pessoa.${nome}.${SUFIXO}`;
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

beforeAll(async () => {
  app = createApp();
  owner = (await entrar("teste.owner")).body;
  rh = (await entrar("teste.rh")).body;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: criados } } });
});

describe("quem é quem [S1-B]", () => {
  it("a lista mostra o papel e o que cada um lê e grava", async () => {
    const res = await request(app).get("/api/pessoas-acessos").set(as(owner.token));
    expect(res.status).toBe(200);
    const people = res.body.people as {
      login: string;
      org_role: string;
      permission: string;
      modules: Record<string, string>;
      can_reset_password: boolean;
      id: string;
    }[];
    const colab = people.find((p) => p.login === "teste.colaborador")!;
    expect(colab.org_role).toBe("COLABORADOR");
    expect(colab.permission).toBe("colaborador");
    expect(colab.modules.inventario).toBe("read");
    expect(colab.modules.atestados).toBe("write");
    expect(colab.modules.comite).toBeUndefined();

    const fiscal = people.find((p) => p.login === "teste.fiscal")!;
    expect(fiscal.permission).toBe("fiscal");
    expect(Object.values(fiscal.modules).every((l) => l === "read")).toBe(true);

    // ninguém redefine a própria senha por aqui, nem a do Master
    expect(people.find((p) => p.id === owner.user.id)?.can_reset_password).toBe(false);
    expect(people.find((p) => p.login === "teste.master")?.can_reset_password).toBe(false);
    expect(colab.can_reset_password).toBe(true);
  });

  it("só quem cuida de Conta e usuários vê a lista", async () => {
    for (const login of ["teste.sst", "teste.supervisor", "teste.colaborador", "teste.fiscal"]) {
      const token = (await entrar(login)).body.token as string;
      const res = await request(app).get("/api/pessoas-acessos").set(as(token));
      expect(res.status, login).toBe(403);
    }
  });
});

describe("redefinir a senha de outra pessoa [S1-D]", () => {
  it("gera uma provisória, derruba a sessão aberta e exige troca no primeiro acesso", async () => {
    const p = await criarPessoa("redefinida", Role.COLABORADOR);
    const antes = (await entrar(p.login)).body.token as string;
    expect((await request(app).get("/api/auth").set(as(antes))).status).toBe(200);

    const res = await request(app)
      .post(`/api/pessoas-acessos/${p.id}/redefinir-senha`)
      .set(as(rh.token));
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const provisoria = res.body.temporary_password as string;
    expect(provisoria).toMatch(/^[a-zA-Z2-9]{12}$/);

    // sessão antiga caiu; senha antiga não entra mais
    expect((await request(app).get("/api/auth").set(as(antes))).status).toBe(401);
    expect((await entrar(p.login)).status).toBe(401);

    // provisória entra, mas só para trocar a senha
    const novo = await entrar(p.login, provisoria);
    expect(novo.status).toBe(200);
    const token = novo.body.token as string;
    expect((await request(app).get("/api/inventory").set(as(token))).body.code).toBe("MUST_CHANGE_PASSWORD");
    const troca = await request(app)
      .post("/api/auth/password")
      .set(as(token))
      .send({ current_password: provisoria, new_password: "nova-senha-123" });
    expect(troca.status).toBe(200);
    expect((await request(app).get("/api/inventory").set(as(token))).status).toBe(200);

    // a trilha registra quem redefiniu, sem a senha
    const trilha = await prisma.auditEvent.findFirst({
      where: { action: "user.password_reset", entityId: p.id },
    });
    expect(trilha?.actorId).toBe(rh.user.id);
    expect(JSON.stringify(trilha)).not.toContain(provisoria);
  });

  it("o RH não redefine a própria senha nem a de quem está acima ou ao lado", async () => {
    const proprio = await request(app)
      .post(`/api/pessoas-acessos/${rh.user.id}/redefinir-senha`)
      .set(as(rh.token));
    expect(proprio.status).toBe(400);

    for (const login of ["teste.owner", "teste.master", "teste.sst"]) {
      const alvo = await prisma.user.findFirstOrThrow({ where: { login } });
      const res = await request(app)
        .post(`/api/pessoas-acessos/${alvo.id}/redefinir-senha`)
        .set(as(rh.token));
      expect(res.status, login).toBe(403);
    }
  });

  it("quem não cuida de Conta e usuários não redefine nada", async () => {
    const p = await criarPessoa("protegida", Role.COLABORADOR);
    for (const login of ["teste.sst", "teste.gerente", "teste.fiscal"]) {
      const token = (await entrar(login)).body.token as string;
      const res = await request(app)
        .post(`/api/pessoas-acessos/${p.id}/redefinir-senha`)
        .set(as(token));
      expect(res.status, login).toBe(403);
    }
    expect((await entrar(p.login)).status).toBe(200);
  });

  it("pessoa de outra organização não é encontrada", async () => {
    const outra = await prisma.user.findFirstOrThrow({ where: { login: "admin" } });
    const res = await request(app)
      .post(`/api/pessoas-acessos/${outra.id}/redefinir-senha`)
      .set(as(owner.token));
    expect(res.status).toBe(404);
  });
});
