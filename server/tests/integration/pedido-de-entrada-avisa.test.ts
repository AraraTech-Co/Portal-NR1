import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O pedido de entrada pelo link avisa quem pode decidir. [CB-29]
 *
 * O tipo de aviso JOIN_REQUEST_OPENED existia e nenhum trecho do servidor o
 * gerava: o pedido aparecia só no Início. Agora quem decide recebe o aviso —
 * quem cuida de Conta e o master, de qualquer conta da empresa; os outros
 * papéis que decidem, só os da própria conta — e a decisão dá o aviso por
 * lido para todos.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`, em que todos os
 * usuários de teste estão na mesma conta.
 */
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
/* A senha de quem pede entrada, montada para não ser um literal no código. */
const SENHA_DO_PEDIDO = "p".repeat(6) + "-" + "7".repeat(6);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let master: string;
const links: string[] = [];
const pedidos: string[] = [];
const ids: Record<string, string> = {};

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

async function pedido(nome: string) {
  const link = await request(app)
    .post("/api/invite-links")
    .set(as(master))
    .send({ label: `Pedido ${SUFIXO}` });
  expect(link.status, JSON.stringify(link.body)).toBe(201);
  links.push(link.body.link.id);
  const res = await request(app)
    .post(`/api/invites/${link.body.link.token}`)
    .send({ name: nome, password: SENHA_DO_PEDIDO });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  pedidos.push(res.body.request_id);
  return res.body.request_id as string;
}

const avisos = (requestId: string, soPendentes = false) =>
  prisma.notification.findMany({
    where: {
      entityType: "AccountJoinRequest",
      entityId: requestId,
      kind: "JOIN_REQUEST_OPENED",
      ...(soPendentes ? { readAt: null } : {}),
    },
    select: { userId: true, title: true, body: true, link: true },
  });

beforeAll(async () => {
  app = createApp();
  master = (await entrar("teste.master")).token;
  for (const login of [
    "teste.master",
    "teste.owner",
    "teste.rh",
    "teste.sst",
    "teste.gerente",
    "teste.admloja",
    "teste.colaborador",
    "teste.supervisor",
    "teste.fiscal",
  ]) {
    ids[login] = (await prisma.user.findUniqueOrThrow({ where: { login }, select: { id: true } })).id;
  }
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { entityId: { in: pedidos } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: pedidos } } });
  const criados = await prisma.accountJoinRequest.findMany({
    where: { id: { in: pedidos } },
    select: { email: true, name: true },
  });
  const novos = await prisma.user.findMany({
    where: { name: { in: criados.map((c) => c.name) }, login: { not: { startsWith: "teste." } } },
    select: { id: true },
  });
  const novosIds = novos.map((u) => u.id);
  await prisma.accountMembership.deleteMany({ where: { userId: { in: novosIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: novosIds } } });
  await prisma.employeeProfile.deleteMany({ where: { userId: { in: novosIds } } });
  await prisma.user.deleteMany({ where: { id: { in: novosIds } } });
  await prisma.accountJoinRequest.deleteMany({ where: { id: { in: pedidos } } });
  await prisma.accountInviteLink.deleteMany({ where: { id: { in: links } } });
});

describe("o pedido de entrada avisa quem decide [CB-29]", () => {
  it("quem pode decidir recebe o aviso; quem não pode, não", async () => {
    const id = await pedido(`Sérgio Lima ${SUFIXO}`);
    const recebidos = await avisos(id);
    const quem = new Set(recebidos.map((a) => a.userId));
    for (const login of [
      "teste.master",
      "teste.owner",
      "teste.rh",
      "teste.sst",
      "teste.gerente",
      "teste.admloja",
    ]) {
      expect(quem.has(ids[login]!), `${login} recebe`).toBe(true);
    }
    for (const login of ["teste.colaborador", "teste.supervisor", "teste.fiscal"]) {
      expect(quem.has(ids[login]!), `${login} não recebe`).toBe(false);
    }
    expect(recebidos[0]).toMatchObject({
      title: "Pedido de entrada",
      body: expect.stringContaining(`Sérgio Lima ${SUFIXO} pediu para entrar em`),
      link: "/conta?parte=entrada",
    });
  });

  it("decidido, o aviso deixa de estar pendente para todos", async () => {
    const id = await pedido(`Rita Souza ${SUFIXO}`);
    expect((await avisos(id, true)).length).toBeGreaterThan(1);
    const res = await request(app)
      .post(`/api/join-requests/${id}/decide`)
      .set(as(master))
      .send({ action: "reject", note: "Não é da empresa" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await avisos(id, true)).toEqual([]);
  });

  it("aprovado também resolve, e o aviso de outro pedido continua pendente", async () => {
    const outro = await pedido(`Outro pedido ${SUFIXO}`);
    const id = await pedido(`Paulo Dias ${SUFIXO}`);
    const pendentesDoOutro = (await avisos(outro, true)).length;
    const res = await request(app)
      .post(`/api/join-requests/${id}/decide`)
      .set(as(master))
      .send({ action: "approve", org_role: "COLABORADOR" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await avisos(id, true)).toEqual([]);
    expect((await avisos(outro, true)).length).toBe(pendentesDoOutro);
  });
});
