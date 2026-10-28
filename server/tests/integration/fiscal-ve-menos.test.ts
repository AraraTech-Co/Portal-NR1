import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { canSeeAllInModule } from "../../src/helper/module-access";

/**
 * O que o fiscal vê das pessoas.
 *
 * O fiscal precisa saber quem é quem — nome, matrícula, função, admissão —
 * e não CPF, telefone, contato nem por que alguém foi desligado. A pasta de
 * Documentos do RH continua aberta para ele, e só para os documentos
 * gerais: é onde ficam a ordem de serviço e os termos de ciência. [CB-43]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
const MOTIVO = `Pedido de demissão registrado no teste ${SUFIXO}`;

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let fiscal: string;
let rh: string;
/** Um documento que o fiscal lia: geral, sem dono. */
let docGeral = "";
/** Uma pessoa desligada com motivo — o motivo é o que não pode vazar. */
let desligadoId = "";
let desligadoPerfil = "";

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body.token as string;
}

beforeAll(async () => {
  app = createApp();
  fiscal = await entrar("teste.fiscal");
  rh = await entrar("teste.rh");

  const geral = await prisma.hrDocument.findFirst({
    where: { organizationId: ORG_ID, targetUserId: null },
    select: { id: true },
  });
  expect(geral, "um documento geral do RH no seed").toBeTruthy();
  docGeral = geral!.id;

  /*
    Sem alguém desligado com motivo, a conferência do motivo passaria por
    não haver motivo nenhum — e não provaria coisa alguma.
  */
  const login = `fiscal.desligado.${SUFIXO}`;
  const user = await prisma.user.create({
    data: {
      login,
      email: `${login}@teste.local`,
      name: `Desligado ${SUFIXO}`,
      passwordHash: await bcrypt.hash(SENHA, 10),
    },
  });
  desligadoId = user.id;
  await prisma.membership.create({
    data: { userId: user.id, organizationId: ORG_ID, role: Role.COLABORADOR },
  });
  const perfil = await prisma.employeeProfile.create({
    data: {
      organizationId: ORG_ID,
      userId: user.id,
      registration: `DES-${SUFIXO}`,
      admittedAt: new Date("2024-03-01"),
      dismissedAt: new Date("2026-09-30"),
      dismissalReason: MOTIVO,
    },
  });
  desligadoPerfil = perfil.id;
});

afterAll(async () => {
  await prisma.employeeProfile.deleteMany({ where: { id: desligadoPerfil } });
  await prisma.membership.deleteMany({ where: { userId: desligadoId } });
  await prisma.user.deleteMany({ where: { id: desligadoId } });
});

describe("a pasta do RH não é do fiscal [CB-43]", () => {
  /*
    Pela decisão, o fiscal deixa de ver a pasta de Documentos do RH. Antes
    ele lia a parte geral; agora nem a lista abre. [CB-43]
  */
  it("o menu do fiscal não traz Documentos do RH", async () => {
    const res = await request(app).post("/api/auth").send({ login: "teste.fiscal", password: "teste1234" });
    expect(res.status).toBe(200);
    expect(res.body.user.modules.documentos_rh ?? "none").toBe("none");
    expect(res.body.user.modules.colaboradores).toBe("read");
  });

  it("nem a regra de ver o registro de todos inclui a pasta do RH", () => {
    expect(canSeeAllInModule("fiscal", "documentos_rh")).toBe(false);
    expect(canSeeAllInModule("fiscal", "colaboradores")).toBe(true);
  });

  it("a lista de Documentos do RH é recusada", async () => {
    const res = await request(app).get("/api/hr-documents").set(as(fiscal));
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it("nem o documento geral, nem o de uma pessoa, abrem", async () => {
    const pessoal = await prisma.hrDocument.findFirst({
      where: { organizationId: ORG_ID, targetUserId: { not: null } },
      select: { id: true },
    });
    expect(pessoal, "um documento de pessoa no seed").toBeTruthy();
    for (const id of [docGeral, pessoal!.id]) {
      const res = await request(app).get(`/api/hr-documents/${id}`).set(as(fiscal));
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    }
  });

  it("a ordem de serviço também abre pela porta dela", async () => {
    const res = await request(app).get("/api/service-orders").set(as(fiscal));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});

describe("a ficha que o fiscal lê [CB-43]", () => {
  it("traz quem é quem, sem CPF, telefone, contato nem motivo de desligamento", async () => {
    const lista = await request(app)
      .get("/api/employee-profiles?include_dismissed=true")
      .set(as(fiscal));
    expect(lista.status, JSON.stringify(lista.body)).toBe(200);
    const fichas = lista.body.profiles as Array<Record<string, unknown>>;
    expect(fichas.length).toBeGreaterThan(0);

    // A pessoa desligada com motivo tem de estar nesta lista.
    const oDesligado = fichas.find((f) => f.id === desligadoPerfil);
    expect(oDesligado, "a ficha de quem foi desligado").toBeTruthy();
    expect(oDesligado!.dismissedAt, "a data do desligamento segue visível").toBeTruthy();

    for (const f of fichas) {
      expect(f.taxId, "CPF").toBeNull();
      expect(f.phone, "telefone").toBeNull();
      expect(f.dismissalReason, "motivo do desligamento").toBeNull();
      const user = f.user as Record<string, unknown>;
      expect(Object.keys(user).sort()).toEqual(["id", "name"]);
      // O que a fiscalização precisa continua lá.
      expect(f).toHaveProperty("registration");
      expect(f).toHaveProperty("admittedAt");
      expect(f).toHaveProperty("jobRole");
    }
  });

  it("a ficha completa de quem foi desligado segue a mesma regra", async () => {
    const ficha = await request(app)
      .get(`/api/employee-profiles/${desligadoPerfil}/ficha`)
      .set(as(fiscal));
    expect(ficha.status, JSON.stringify(ficha.body)).toBe(200);
    expect(ficha.body.profile.taxId).toBeNull();
    expect(ficha.body.profile.phone).toBeNull();
    expect(ficha.body.profile.dismissalReason).toBeNull();
    expect(Object.keys(ficha.body.profile.user).sort()).toEqual(["id", "name"]);
  });

  it("quem cuida do RH continua vendo CPF e o motivo do desligamento", async () => {
    const lista = await request(app)
      .get("/api/employee-profiles?include_dismissed=true")
      .set(as(rh));
    expect(lista.status, JSON.stringify(lista.body)).toBe(200);
    const comCpf = (lista.body.profiles as Array<{ taxId: string | null }>).filter(
      (p) => p.taxId,
    );
    expect(comCpf.length, "fichas com CPF para o RH").toBeGreaterThan(0);
    const alguem = lista.body.profiles[0];
    expect(Object.keys(alguem.user)).toContain("login");

    const oDesligado = (
      lista.body.profiles as Array<{ id: string; dismissalReason: string | null }>
    ).find((p) => p.id === desligadoPerfil);
    expect(oDesligado?.dismissalReason).toBe(MOTIVO);
  });
});

describe("a caixa de avisos não leva a becos [B2-4-F]", () => {
  it("aviso de módulo fechado não chega ao fiscal", async () => {
    const eu = await request(app).get("/api/auth").set(as(fiscal));
    const meuId = eu.body.user.id as string;

    /*
      Um aviso de mural dirigido ao fiscal: é o que existia de verdade, de
      antes de o mural passar a ter público.
    */
    const beco = await prisma.notification.create({
      data: {
        organizationId: ORG_ID,
        userId: meuId,
        kind: "ANNOUNCEMENT_PUBLISHED",
        title: `Aviso de mural para o fiscal ${SUFIXO}`,
        link: "/mural?open=qualquer",
      },
      select: { id: true },
    });
    const valido = await prisma.notification.create({
      data: {
        organizationId: ORG_ID,
        userId: meuId,
        kind: "SERVICE_ORDER_ISSUED",
        title: `Ordem de serviço para o fiscal ${SUFIXO}`,
        link: "/ordens-servico",
      },
      select: { id: true },
    });

    try {
      const res = await request(app).get("/api/notificacoes").set(as(fiscal));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ids = (res.body.notifications as Array<{ id: string }>).map((n) => n.id);
      expect(ids).not.toContain(beco.id);
      // O que ele abre continua chegando — e contando.
      expect(ids).toContain(valido.id);
      expect(res.body.unread).toBeGreaterThan(0);

      const titulos = (res.body.notifications as Array<{ title: string }>).map(
        (n) => n.title,
      );
      expect(titulos.join(" ")).not.toContain("mural");
    } finally {
      await prisma.notification.deleteMany({
        where: { id: { in: [beco.id, valido.id] } },
      });
    }
  });

  it("quem tem o módulo continua recebendo o mesmo aviso", async () => {
    const rhMe = await request(app).get("/api/auth").set(as(rh));
    const rhId = rhMe.body.user.id as string;
    const doRh = await prisma.notification.create({
      data: {
        organizationId: ORG_ID,
        userId: rhId,
        kind: "ANNOUNCEMENT_PUBLISHED",
        title: `Aviso de mural para o RH ${SUFIXO}`,
        link: "/mural?open=qualquer",
      },
      select: { id: true },
    });
    try {
      const res = await request(app).get("/api/notificacoes").set(as(rh));
      const ids = (res.body.notifications as Array<{ id: string }>).map((n) => n.id);
      expect(ids).toContain(doRh.id);
    } finally {
      await prisma.notification.delete({ where: { id: doRh.id } });
    }
  });
});
