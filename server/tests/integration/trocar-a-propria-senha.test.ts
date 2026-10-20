import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { orgRoleToAccountRole } from "../../src/helper/auth";

/**
 * Trocar a própria senha, sem depender de ninguém.
 *
 * A tela de troca só abria para quem era obrigado a trocar; quem digitou
 * errado na troca obrigatória, ou desconfia que a senha vazou, dependia de
 * alguém redefinir por Pessoas e acessos. O servidor sempre aceitou — o que
 * faltava era a porta. Estes casos guardam a regra em que a porta se
 * apoia. [B2-1-G]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
/*
  As senhas deste arquivo são montadas a partir do sufixo, e não escritas
  como literal: assim nenhuma cadeia com cara de segredo fica no
  repositório, que é público.
*/
const SENHA = `senha-do-teste-${Date.now().toString(36)}`;
const SUFIXO = Date.now().toString(36);
const LOGIN = `troca.senha.${SUFIXO}`;
const NOVA = `nova-senha-${SUFIXO}`;
const CHUTE = `chute-de-alguem-${SUFIXO}`;
const CURTA = "1234";

let app: Express;
let token = "";
let userId = "";
let accountId = "";

async function entrar(senha: string) {
  return request(app).post("/api/auth").send({ login: LOGIN, password: senha });
}

beforeAll(async () => {
  app = createApp();
  const conta = await prisma.account.findFirst({
    where: { organizationId: ORG_ID },
    select: { id: true },
  });
  accountId = conta!.id;

  /*
    Pessoa própria deste arquivo: trocar a senha de alguém do seed deixaria
    os outros testes sem conseguir entrar.
  */
  const user = await prisma.user.create({
    data: {
      login: LOGIN,
      email: `${LOGIN}@teste.local`,
      name: `Troca de senha ${SUFIXO}`,
      passwordHash: await bcrypt.hash(SENHA, 10),
    },
  });
  userId = user.id;
  await prisma.membership.create({
    data: { userId, organizationId: ORG_ID, role: Role.COLABORADOR },
  });
  await prisma.accountMembership.create({
    data: { accountId, userId, role: orgRoleToAccountRole(Role.COLABORADOR) },
  });

  const login = await entrar(SENHA);
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  token = login.body.token;
  // Quem não é obrigado a trocar: é justamente o caso que a tela recusava.
  expect(login.body.user.must_change_password).toBe(false);
});

afterAll(async () => {
  await prisma.accountMembership.deleteMany({ where: { userId } });
  await prisma.membership.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe("trocar a própria senha [B2-1-G]", () => {
  it("quem não é obrigado a trocar também troca", async () => {
    const res = await request(app)
      .post("/api/auth/password")
      .set({ Authorization: `Bearer ${token}` })
      .send({ current_password: SENHA, new_password: NOVA });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // A senha antiga deixa de valer, e a nova vale.
    const velha = await entrar(SENHA);
    expect(velha.status).toBe(401);
    const novaEntrada = await entrar(NOVA);
    expect(novaEntrada.status, JSON.stringify(novaEntrada.body)).toBe(200);
    token = novaEntrada.body.token;
  });

  it("sem a senha atual, não troca", async () => {
    const res = await request(app)
      .post("/api/auth/password")
      .set({ Authorization: `Bearer ${token}` })
      .send({ current_password: CHUTE, new_password: `${NOVA}-2` });
    expect(res.status, JSON.stringify(res.body)).toBe(401);

    // E a senha de antes continua valendo.
    const ainda = await entrar(NOVA);
    expect(ainda.status).toBe(200);
  });

  it("senha curta e senha igual à atual são recusadas", async () => {
    const curta = await request(app)
      .post("/api/auth/password")
      .set({ Authorization: `Bearer ${token}` })
      .send({ current_password: NOVA, new_password: CURTA });
    expect(curta.status).toBe(400);

    const igual = await request(app)
      .post("/api/auth/password")
      .set({ Authorization: `Bearer ${token}` })
      .send({ current_password: NOVA, new_password: NOVA });
    expect(igual.status).toBe(400);
  });

  it("sem sessão, ninguém troca a senha de ninguém", async () => {
    const res = await request(app)
      .post("/api/auth/password")
      .send({ current_password: NOVA, new_password: `${NOVA}-3` });
    expect(res.status).toBe(401);
  });
});
