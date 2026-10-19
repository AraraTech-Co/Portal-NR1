import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { Role } from "@prisma/client";
import { orgRoleToAccountRole } from "../../src/helper/auth";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O aviso do mural passa a ter público.
 *
 * Ia para todas as pessoas com acesso à organização, de todas as unidades,
 * inclusive o fiscal e quem já tinha sido desligado; quem publicava não
 * tinha como escolher [CB-33]. E "quem leu" usava a mesma base: "2 de 19
 * leram" contava como não lido o fiscal, o desligado e as outras unidades
 * [CB-36].
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: { token: string; user: { id: string } };

/** A unidade do seed (onde estão colaborador, supervisor e RH). */
let unidadeA = "";
/** Uma segunda unidade, criada aqui. */
let unidadeB = "";
let sectorB = "";
let jobRoleB = "";
let accountId = "";

const avisos: string[] = [];
const usuarios: string[] = [];
const pessoas: Record<string, { id: string; token: string }> = {};

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

/** Uma pessoa nova desta empresa, com unidade e situação escolhidas. */
async function criarPessoa(
  apelido: string,
  opts: {
    role?: Role;
    jobRoleId?: string | null;
    dismissedAt?: Date | null;
    accessExpiresAt?: Date | null;
  } = {},
) {
  // O login é sempre lido em minúsculas: criar com maiúscula não entraria.
  const login = `mural.${apelido.toLowerCase()}.${SUFIXO}`;
  const user = await prisma.user.create({
    data: {
      login,
      email: `${login}@teste.local`,
      name: `Mural ${apelido} ${SUFIXO}`,
      passwordHash: await bcrypt.hash(SENHA, 10),
    },
  });
  usuarios.push(user.id);
  await prisma.membership.create({
    data: {
      userId: user.id,
      organizationId: ORG_ID,
      role: opts.role ?? Role.COLABORADOR,
      accessExpiresAt: opts.accessExpiresAt ?? null,
    },
  });
  // Sem papel na conta, o login responde "usuário sem conta acessível".
  await prisma.accountMembership.create({
    data: {
      accountId,
      userId: user.id,
      role: orgRoleToAccountRole(opts.role ?? Role.COLABORADOR),
    },
  });
  if (opts.jobRoleId !== null) {
    await prisma.employeeProfile.create({
      data: {
        organizationId: ORG_ID,
        userId: user.id,
        jobRoleId: opts.jobRoleId ?? jobRoleB,
        dismissedAt: opts.dismissedAt ?? null,
      },
    });
  }
  const token = (await entrar(login)).token;
  pessoas[apelido] = { id: user.id, token };
  return pessoas[apelido]!;
}

async function publicar(
  token: string,
  input: { title: string; establishment_ids?: string[] },
) {
  const res = await request(app)
    .post("/api/announcements")
    .set(as(token))
    .send({
      kind: "NOTICE",
      title: input.title,
      body: "Conteúdo do aviso de teste automatizado.",
      ...(input.establishment_ids
        ? { establishment_ids: input.establishment_ids }
        : {}),
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  avisos.push(res.body.announcement.id);
  return res.body as {
    announcement: { id: string };
    notified: number;
  };
}

beforeAll(async () => {
  app = createApp();
  rh = await entrar("teste.rh");

  const conta = await prisma.account.findFirst({
    where: { organizationId: ORG_ID },
    select: { id: true },
  });
  accountId = conta?.id ?? "";
  expect(accountId, "a conta do seed").toBeTruthy();

  const doSeed = await prisma.employeeProfile.findFirst({
    where: { organizationId: ORG_ID, userId: rh.user.id },
    select: { jobRole: { select: { sector: { select: { establishmentId: true } } } } },
  });
  unidadeA = doSeed?.jobRole?.sector.establishmentId ?? "";
  expect(unidadeA, "a unidade do seed").toBeTruthy();

  const estab = await prisma.establishment.create({
    data: { organizationId: ORG_ID, name: `Filial ${SUFIXO}` },
  });
  unidadeB = estab.id;
  const setor = await prisma.sector.create({
    data: { organizationId: ORG_ID, establishmentId: unidadeB, name: `Setor ${SUFIXO}` },
  });
  sectorB = setor.id;
  const funcao = await prisma.jobRole.create({
    data: { organizationId: ORG_ID, sectorId: sectorB, name: `Função ${SUFIXO}` },
  });
  jobRoleB = funcao.id;

  await criarPessoa("daFilial");
  await criarPessoa("desligado", { dismissedAt: new Date("2026-09-30") });
  await criarPessoa("fiscal", {
    role: Role.FISCAL,
    jobRoleId: null,
    accessExpiresAt: new Date("2027-12-31"),
  });
  await criarPessoa("semUnidade", { jobRoleId: null });
});

afterAll(async () => {
  await prisma.notification.deleteMany({
    where: { entityType: "Announcement", entityId: { in: avisos } },
  });
  await prisma.announcement.deleteMany({ where: { id: { in: avisos } } });
  await prisma.accountMembership.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.employeeProfile.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.membership.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.notification.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.jobRole.deleteMany({ where: { id: jobRoleB } });
  await prisma.sector.deleteMany({ where: { id: sectorB } });
  await prisma.establishment.deleteMany({ where: { id: unidadeB } });
});

/** A quem o portal avisou sobre este aviso. */
async function avisados(announcementId: string): Promise<string[]> {
  const rows = await prisma.notification.findMany({
    where: { entityType: "Announcement", entityId: announcementId },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

describe("quem recebe o aviso [CB-33]", () => {
  it("o fiscal e quem foi desligado nunca recebem, nem no aviso da empresa toda", async () => {
    const { announcement } = await publicar(rh.token, {
      title: `Aviso para a empresa toda ${SUFIXO}`,
    });
    const quem = await avisados(announcement.id);

    expect(quem).not.toContain(pessoas.fiscal!.id);
    expect(quem).not.toContain(pessoas.desligado!.id);
    // Quem está na empresa recebe, de qualquer unidade.
    expect(quem).toContain(pessoas.daFilial!.id);
    expect(quem).toContain(pessoas.semUnidade!.id);
    // Quem publicou não é avisado do próprio aviso.
    expect(quem).not.toContain(rh.user.id);
  });

  it("escolhida uma unidade, só quem trabalha nela recebe", async () => {
    const { announcement, notified } = await publicar(rh.token, {
      title: `Aviso só da filial ${SUFIXO}`,
      establishment_ids: [unidadeB],
    });
    const quem = await avisados(announcement.id);

    expect(quem).toContain(pessoas.daFilial!.id);
    expect(quem).not.toContain(pessoas.semUnidade!.id);
    expect(quem).not.toContain(pessoas.fiscal!.id);
    expect(quem).not.toContain(pessoas.desligado!.id);
    // O RH é da outra unidade: não recebe (e também é quem publicou).
    expect(quem).not.toContain(rh.user.id);
    expect(notified).toBe(quem.length);
  });

  it("a tela diz quantas pessoas receberam", async () => {
    const { notified } = await publicar(rh.token, {
      title: `Aviso com contagem ${SUFIXO}`,
      establishment_ids: [unidadeB],
    });
    // Só a pessoa da filial, criada aqui.
    expect(notified).toBe(1);
  });

  it("unidade de outra empresa, ou inexistente, é recusada", async () => {
    const res = await request(app)
      .post("/api/announcements")
      .set(as(rh.token))
      .send({
        kind: "NOTICE",
        title: `Aviso inválido ${SUFIXO}`,
        body: "Conteúdo do aviso de teste automatizado.",
        establishment_ids: ["00000000-0000-4000-8000-00000000dead"],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });
});

describe("o mural mostra o que é para quem olha [CB-33]", () => {
  it("quem é de outra unidade não vê o aviso da filial", async () => {
    const { announcement } = await publicar(rh.token, {
      title: `Só a filial vê ${SUFIXO}`,
      establishment_ids: [unidadeB],
    });

    const daFilial = await request(app)
      .get("/api/announcements")
      .set(as(pessoas.daFilial!.token));
    expect(daFilial.status, JSON.stringify(daFilial.body)).toBe(200);
    expect(
      daFilial.body.announcements.map((a: { id: string }) => a.id),
    ).toContain(announcement.id);

    const colaborador = await entrar("teste.colaborador");
    const daOutra = await request(app)
      .get("/api/announcements")
      .set(as(colaborador.token));
    expect(daOutra.status, JSON.stringify(daOutra.body)).toBe(200);
    expect(
      daOutra.body.announcements.map((a: { id: string }) => a.id),
    ).not.toContain(announcement.id);

    // Nem abrindo pelo link direto.
    const abrir = await request(app)
      .get(`/api/announcements/${announcement.id}`)
      .set(as(colaborador.token));
    expect(abrir.status, JSON.stringify(abrir.body)).toBe(404);
  });

  it("quem cuida do mural vê tudo, para poder cobrar leitura", async () => {
    const { announcement } = await publicar(rh.token, {
      title: `Da filial, visto pelo RH ${SUFIXO}`,
      establishment_ids: [unidadeB],
    });
    const lista = await request(app).get("/api/announcements").set(as(rh.token));
    const achado = lista.body.announcements.find(
      (a: { id: string }) => a.id === announcement.id,
    );
    expect(achado, "o aviso da filial na lista de quem publica").toBeTruthy();
    expect(achado.establishments.map((u: { id: string }) => u.id)).toEqual([
      unidadeB,
    ]);
  });

  it("a contagem da lista é sobre o público, não sobre quem abriu", async () => {
    const { announcement } = await publicar(rh.token, {
      title: `Contagem da lista ${SUFIXO}`,
      establishment_ids: [unidadeB],
    });
    /*
      Quem publicou é de outra unidade: abrir o aviso não pode fazer a lista
      dizer "1 leitura" enquanto "quem leu" diz "0 de 1". [CB-36]
    */
    await request(app)
      .post(`/api/announcements/${announcement.id}/read`)
      .set(as(rh.token));

    const lista = await request(app).get("/api/announcements").set(as(rh.token));
    const achado = lista.body.announcements.find(
      (a: { id: string }) => a.id === announcement.id,
    );
    expect(achado.audience_count).toBe(1);
    expect(achado.read_count).toBe(0);

    const leituras = await request(app)
      .get(`/api/announcements/${announcement.id}/leituras`)
      .set(as(rh.token));
    expect(leituras.body.read).toBe(achado.read_count);
    expect(leituras.body.readers.length).toBe(achado.audience_count);
  });

  it("o aviso da empresa toda aparece para todo mundo que o recebe", async () => {
    const { announcement } = await publicar(rh.token, {
      title: `Para todos ${SUFIXO}`,
    });
    for (const quem of [pessoas.daFilial!, pessoas.semUnidade!]) {
      const lista = await request(app)
        .get("/api/announcements")
        .set(as(quem.token));
      expect(
        lista.body.announcements.map((a: { id: string }) => a.id),
      ).toContain(announcement.id);
    }
  });
});

describe("quem leu conta só quem devia ler [CB-36]", () => {
  it("a base é o público do aviso, sem fiscal nem desligado", async () => {
    const { announcement } = await publicar(rh.token, {
      title: `Leituras da empresa toda ${SUFIXO}`,
    });
    const res = await request(app)
      .get(`/api/announcements/${announcement.id}/leituras`)
      .set(as(rh.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const ids = res.body.readers.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(pessoas.fiscal!.id);
    expect(ids).not.toContain(pessoas.desligado!.id);
    expect(ids).toContain(pessoas.daFilial!.id);
    expect(ids).toContain(rh.user.id);
    expect(res.body.read + res.body.pending).toBe(res.body.readers.length);
  });

  it("no aviso de unidade, a conta é só daquela unidade", async () => {
    const { announcement } = await publicar(rh.token, {
      title: `Leituras da filial ${SUFIXO}`,
      establishment_ids: [unidadeB],
    });
    const res = await request(app)
      .get(`/api/announcements/${announcement.id}/leituras`)
      .set(as(rh.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const ids = res.body.readers.map((p: { id: string }) => p.id);
    expect(ids).toEqual([pessoas.daFilial!.id]);
    expect(res.body.pending).toBe(1);
    expect(res.body.read).toBe(0);
    expect(res.body.announcement.establishments.map((u: { id: string }) => u.id)).toEqual([
      unidadeB,
    ]);
  });

  it("depois de ler, a pessoa sai da pendência", async () => {
    const { announcement } = await publicar(rh.token, {
      title: `Leitura confirmada ${SUFIXO}`,
      establishment_ids: [unidadeB],
    });
    const ler = await request(app)
      .post(`/api/announcements/${announcement.id}/read`)
      .set(as(pessoas.daFilial!.token));
    expect(ler.status, JSON.stringify(ler.body)).toBe(200);

    const res = await request(app)
      .get(`/api/announcements/${announcement.id}/leituras`)
      .set(as(rh.token));
    expect(res.body.read).toBe(1);
    expect(res.body.pending).toBe(0);
  });
});
