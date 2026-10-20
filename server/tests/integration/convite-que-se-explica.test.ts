import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O link de convite que diz o que é.
 *
 * Os links nasciam todos "Ativo" e continuavam "Ativo" depois de esgotados
 * ou vencidos; não havia como informar validade, embora o portal já
 * recusasse link vencido; a lista não dizia quem tinha usado cada um; e o
 * papel fixo no link chegava à aprovação sem poder ser revisto.
 * [S1-L] [S1-N] [S1-P] [S5-I]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let master: string;
const links: string[] = [];
const pedidos: string[] = [];
const usuarios: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

async function criarLink(corpo: Record<string, unknown>) {
  const res = await request(app)
    .post("/api/invite-links")
    .set(as(master))
    .send({ label: `Teste ${SUFIXO}`, ...corpo });
  if (res.status === 201) links.push(res.body.link.id);
  return res;
}

/** Amanhã e ontem, em AAAA-MM-DD no fuso de Brasília. */
function dia(offset: number): string {
  const agora = new Date(Date.now() - 3 * 3_600_000);
  agora.setUTCDate(agora.getUTCDate() + offset);
  return agora.toISOString().slice(0, 10);
}

beforeAll(async () => {
  app = createApp();
  master = (await entrar("teste.master")).token;
});

afterAll(async () => {
  await prisma.accountJoinRequest.deleteMany({ where: { id: { in: pedidos } } });
  await prisma.accountMembership.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.membership.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.employeeProfile.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.accountInviteLink.deleteMany({ where: { id: { in: links } } });
});

describe("o link tem validade [S1-L]", () => {
  it("a validade informada é gravada", async () => {
    const amanha = dia(1);
    const res = await criarLink({ expires_at: amanha });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.link.expires_at).toBeTruthy();
    /*
      A validade é o fim do dia em Brasília; lido em UTC, cai no dia
      seguinte. A conferência é no fuso em que a data foi escolhida.
    */
    const emBrasilia = new Date(
      new Date(res.body.link.expires_at).getTime() - 3 * 3_600_000,
    )
      .toISOString()
      .slice(0, 10);
    expect(emBrasilia).toBe(amanha);
    expect(res.body.link.situation).toBe("active");
  });

  it("sem validade, o link continua valendo até alguém desligar", async () => {
    const res = await criarLink({});
    expect(res.status).toBe(201);
    expect(res.body.link.expires_at).toBeNull();
    expect(res.body.link.situation).toBe("active");
  });

  it("validade no passado é recusada — link que nasce vencido só confunde", async () => {
    const res = await criarLink({ expires_at: dia(-1) });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  it("data fora do formato é recusada", async () => {
    const res = await criarLink({ expires_at: "amanha" });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });
});

describe("a situação do link é a de verdade [S1-N] [S5-I]", () => {
  it("link vencido aparece como vencido, não como ativo", async () => {
    const criado = await criarLink({ expires_at: dia(1) });
    // O portal não deixa criar vencido; para conferir a leitura, vence aqui.
    await prisma.accountInviteLink.update({
      where: { id: criado.body.link.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const lista = await request(app).get("/api/invite-links").set(as(master));
    const achado = lista.body.links.find(
      (l: { id: string }) => l.id === criado.body.link.id,
    );
    expect(achado.situation).toBe("expired");
    expect(achado.active, "o campo cru continua true: a situação é derivada").toBe(true);
  });

  it("link esgotado aparece como esgotado", async () => {
    const criado = await criarLink({ max_uses: 1 });
    await prisma.accountInviteLink.update({
      where: { id: criado.body.link.id },
      data: { usedCount: 1 },
    });
    const lista = await request(app).get("/api/invite-links").set(as(master));
    const achado = lista.body.links.find(
      (l: { id: string }) => l.id === criado.body.link.id,
    );
    expect(achado.situation).toBe("exhausted");
  });

  it("link desligado aparece como desligado", async () => {
    const criado = await criarLink({});
    const off = await request(app)
      .patch(`/api/invite-links/${criado.body.link.id}`)
      .set(as(master));
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    const lista = await request(app).get("/api/invite-links").set(as(master));
    const achado = lista.body.links.find(
      (l: { id: string }) => l.id === criado.body.link.id,
    );
    expect(achado.situation).toBe("off");
  });
});

describe("a lista diz quem usou cada link [S5-I]", () => {
  it("quem pediu entrada aparece no link que usou", async () => {
    const criado = await criarLink({});
    const token = criado.body.link.token as string;

    const nome = `Entrou pelo link ${SUFIXO}`;
    const pedido = await request(app)
      .post(`/api/invites/${token}`)
      .send({ name: nome, password: `senha-do-convite-${SUFIXO}` });
    expect(pedido.status, JSON.stringify(pedido.body)).toBe(201);
    pedidos.push(pedido.body.request_id);

    const lista = await request(app).get("/api/invite-links").set(as(master));
    const achado = lista.body.links.find(
      (l: { id: string }) => l.id === criado.body.link.id,
    );
    expect(achado.used_by).toHaveLength(1);
    expect(achado.used_by[0].name).toBe(nome);
    expect(achado.used_by[0].status).toBe("PENDING");

    // Link sem ninguém continua dizendo que ninguém usou.
    const vazio = await criarLink({});
    const lista2 = await request(app).get("/api/invite-links").set(as(master));
    const semNinguem = lista2.body.links.find(
      (l: { id: string }) => l.id === vazio.body.link.id,
    );
    expect(semNinguem.used_by).toEqual([]);
  });
});

describe("o papel fixo no link é sugestão, não sentença [S1-P]", () => {
  it("quem aprova pode dar outro papel", async () => {
    const criado = await criarLink({
      role_mode: "FIXED",
      org_role: Role.COLABORADOR,
    });
    expect(criado.status, JSON.stringify(criado.body)).toBe(201);

    const pedido = await request(app)
      .post(`/api/invites/${criado.body.link.token}`)
      .send({
        name: `Papel revisto ${SUFIXO}`,
        password: `senha-do-convite-${SUFIXO}`,
      });
    expect(pedido.status, JSON.stringify(pedido.body)).toBe(201);
    pedidos.push(pedido.body.request_id);

    // O pedido chega dizendo o que o link sugeria.
    const lista = await request(app).get("/api/join-requests").set(as(master));
    const naLista = lista.body.requests.find(
      (r: { id: string }) => r.id === pedido.body.request_id,
    );
    expect(naLista.role_mode).toBe("FIXED");
    expect(naLista.suggested_org_role).toBe(Role.COLABORADOR);

    const aprovacao = await request(app)
      .post(`/api/join-requests/${pedido.body.request_id}/decide`)
      .set(as(master))
      .send({ action: "approve", org_role: Role.SUPERVISOR, is_external: true });
    expect(aprovacao.status, JSON.stringify(aprovacao.body)).toBe(200);

    const membro = await prisma.accountJoinRequest.findUnique({
      where: { id: pedido.body.request_id },
      select: { decidedOrgRole: true, status: true },
    });
    expect(membro?.status).toBe("APPROVED");
    expect(membro?.decidedOrgRole, "o papel escolhido na aprovação").toBe(
      Role.SUPERVISOR,
    );

    const criado2 = await prisma.user.findFirst({
      where: { name: `Papel revisto ${SUFIXO}` },
      select: { id: true },
    });
    if (criado2) usuarios.push(criado2.id);
  });

  it("sem papel escolhido, vale o que o link sugeriu", async () => {
    const criado = await criarLink({
      role_mode: "FIXED",
      org_role: Role.SUPERVISOR,
    });
    const pedido = await request(app)
      .post(`/api/invites/${criado.body.link.token}`)
      .send({
        name: `Papel do link ${SUFIXO}`,
        password: `senha-do-convite-${SUFIXO}`,
      });
    pedidos.push(pedido.body.request_id);

    const aprovacao = await request(app)
      .post(`/api/join-requests/${pedido.body.request_id}/decide`)
      .set(as(master))
      .send({ action: "approve", is_external: true });
    expect(aprovacao.status, JSON.stringify(aprovacao.body)).toBe(200);

    const decidido = await prisma.accountJoinRequest.findUnique({
      where: { id: pedido.body.request_id },
      select: { decidedOrgRole: true },
    });
    expect(decidido?.decidedOrgRole).toBe(Role.SUPERVISOR);

    const criado2 = await prisma.user.findFirst({
      where: { name: `Papel do link ${SUFIXO}` },
      select: { id: true },
    });
    if (criado2) usuarios.push(criado2.id);
  });
});
