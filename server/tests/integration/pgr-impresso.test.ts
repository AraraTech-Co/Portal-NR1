import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O documento do PGR impresso, conferido em PDF A4.
 *
 * - O nome e o cargo de quem assina saíam colados ("Eng. Responsável
 *   DemoSESMT"), e o título dos critérios ficava sozinho no pé da página.
 *   [B3-2-C]
 * - O perigo vindo do levantamento preliminar ia para o inventário assinado
 *   com o identificador interno do levantamento e do item e a situação em
 *   inglês ("Preliminar · deferred · item 5994…"); a ação diferida também
 *   trazia os identificadores. [B2-1-C]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const EST_ID = "aaaaaaaa-0001-4000-8000-000000000011";
const ACT_ID = "aaaaaaaa-0001-4000-8000-000000000014";
const SUFIXO = Date.now().toString(36);
const RAIZ = join(__dirname, "..", "..", "..");
const MIGRACAO = join(RAIZ, "prisma", "migrations", "20261029010000_levantamento_preliminar_legivel", "migration.sql");
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let sst: { token: string; user: { id: string } };
const levantamentos: string[] = [];

beforeAll(async () => {
  app = createApp();
  const res = await request(app).post("/api/auth").send({ login: "teste.sst", password: "teste1234" });
  expect(res.status).toBe(200);
  sst = res.body;
});

afterAll(async () => {
  const perigos = await prisma.hazard.findMany({ where: { description: { contains: SUFIXO } }, select: { id: true } });
  await prisma.action.deleteMany({ where: { OR: [{ title: { contains: SUFIXO } }, { description: { contains: SUFIXO } }] } });
  await prisma.risk.deleteMany({ where: { hazardId: { in: perigos.map((p) => p.id) } } });
  await prisma.hazard.deleteMany({ where: { id: { in: perigos.map((p) => p.id) } } });
  await prisma.preliminarySurvey.deleteMany({ where: { id: { in: levantamentos } } });
});

async function levantamento(dia: string) {
  const res = await request(app)
    .post("/api/preliminary-surveys")
    .set(as(sst.token))
    .send({ establishment_id: EST_ID, trigger: "EXISTING_ACTIVITIES", description: `Revisão ${SUFIXO}`, conducted_at: dia });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  levantamentos.push(res.body.survey.id);
  return res.body.survey.id as string;
}

describe("o levantamento preliminar grava texto que se lê [B2-1-C]", () => {
  it("sem medida imediata: a origem diz o dia e a decisão; a ação diz o perigo pelo nome", async () => {
    const id = await levantamento("2026-10-20");
    const res = await request(app).post(`/api/preliminary-surveys/${id}/items`).set(as(sst.token)).send({
      description: `Névoa de óleo ${SUFIXO}`,
      outcome: "DEFERRED_TO_ACTION_PLAN",
      activity_id: ACT_ID,
      category: "CHEMICAL",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.hazard.source).toBe("Levantamento preliminar de 20/10/2026, sem medida imediata");
    expect(res.body.hazard.monitoringData).toBeNull();
    expect(res.body.action.description).not.toMatch(UUID);
    expect(res.body.action.description).toContain(`Perigo: Névoa de óleo ${SUFIXO}`);
  });

  it("para avaliação completa: a origem diz isso", async () => {
    const id = await levantamento("2026-10-21");
    const res = await request(app).post(`/api/preliminary-surveys/${id}/items`).set(as(sst.token)).send({
      description: `Postura forçada ${SUFIXO}`,
      outcome: "ESCALATED_TO_ASSESSMENT",
      activity_id: ACT_ID,
      category: "ERGONOMIC",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.hazard.source).toBe("Levantamento preliminar de 21/10/2026, para avaliação completa");
    expect(res.body.hazard.monitoringData).toBeNull();
  });
});

describe("a migração limpa o que já foi gravado [B2-1-C]", () => {
  it("reescreve origem, situação e ação; o levantamento que não existe mais fica sem dia; roda duas vezes", async () => {
    const id = await levantamento("2026-10-22");
    const perigoAdiado = await prisma.hazard.create({
      data: {
        organizationId: ORG_ID,
        activityId: ACT_ID,
        description: `Antigo adiado ${SUFIXO}`,
        source: `Levantamento preliminar ${id}`,
        monitoringData: "Preliminar · deferred · item 5994567e-e3f4-49a6-b8fd-5189e68dc0e6",
        category: "CHEMICAL",
        status: "IDENTIFIED",
        origin: "ROUTINE_REVIEW",
        createdById: sst.user.id,
      },
    });
    const perigoEscalado = await prisma.hazard.create({
      data: {
        organizationId: ORG_ID,
        activityId: ACT_ID,
        description: `Antigo escalado ${SUFIXO}`,
        source: `Levantamento preliminar ${id}`,
        monitoringData: "Preliminar · escalated · item fb113864-996a-48b5-a030-62e9ee78b581",
        category: "ERGONOMIC",
        status: "IDENTIFIED",
        origin: "ROUTINE_REVIEW",
        createdById: sst.user.id,
      },
    });
    const orfao = await prisma.hazard.create({
      data: {
        organizationId: ORG_ID,
        activityId: ACT_ID,
        description: `Antigo órfão ${SUFIXO}`,
        source: "Levantamento preliminar 00000000-0000-4000-8000-00000000dead",
        category: "CHEMICAL",
        status: "IDENTIFIED",
        origin: "ROUTINE_REVIEW",
        createdById: sst.user.id,
      },
    });
    const acao = await prisma.action.create({
      data: {
        organizationId: ORG_ID,
        title: `Medida diferida ${SUFIXO}`,
        description: `Origem: levantamento preliminar (NR-1 1.5.4.2.1.3).\nItem: 5994567e-e3f4-49a6-b8fd-5189e68dc0e6\nPerigo: ${perigoAdiado.id}`,
        sourceType: "MANUAL",
        priority: "HIGH",
        createdById: sst.user.id,
      },
    });
    const outra = await prisma.hazard.create({
      data: {
        organizationId: ORG_ID,
        activityId: ACT_ID,
        description: `Fonte escrita à mão ${SUFIXO}`,
        source: "Torno CNC",
        monitoringData: "Dosimetria anual",
        category: "PHYSICAL",
        status: "IDENTIFIED",
        origin: "ROUTINE_REVIEW",
        createdById: sst.user.id,
      },
    });

    /* Levantamento de OUTRA empresa com o mesmo identificador no texto: não vale. */
    const outraEmpresa = await prisma.establishment.findFirstOrThrow({
      where: { organizationId: { not: ORG_ID } },
      select: { id: true, organizationId: true },
    });
    const alheio = await prisma.preliminarySurvey.create({
      data: {
        organizationId: outraEmpresa.organizationId,
        establishmentId: outraEmpresa.id,
        trigger: "EXISTING_ACTIVITIES",
        conductedById: (await prisma.user.findFirstOrThrow({ where: { login: "admin" }, select: { id: true } })).id,
        conductedAt: new Date("2026-01-05T00:00:00.000Z"),
      },
    });
    levantamentos.push(alheio.id);
    const cruzado = await prisma.hazard.create({
      data: {
        organizationId: ORG_ID,
        activityId: ACT_ID,
        description: `Cruzado ${SUFIXO}`,
        source: `Levantamento preliminar ${alheio.id}`,
        category: "CHEMICAL",
        status: "IDENTIFIED",
        origin: "ROUTINE_REVIEW",
        createdById: sst.user.id,
      },
    });

    const comandos = readFileSync(MIGRACAO, "utf8")
      .replace(/^--.*$/gm, "")
      .split(/;\s*(?:\n|$)/)
      .map((c) => c.trim())
      .filter(Boolean);
    expect(comandos).toHaveLength(4);
    for (let vez = 0; vez < 2; vez++) for (const c of comandos) await prisma.$executeRawUnsafe(c);

    const ler = (hid: string) =>
      prisma.hazard.findUniqueOrThrow({ where: { id: hid }, select: { source: true, monitoringData: true } });
    expect(await ler(perigoAdiado.id)).toEqual({
      source: "Levantamento preliminar de 22/10/2026, sem medida imediata",
      monitoringData: null,
    });
    expect(await ler(perigoEscalado.id)).toEqual({
      source: "Levantamento preliminar de 22/10/2026, para avaliação completa",
      monitoringData: null,
    });
    expect((await ler(orfao.id)).source).toBe("Levantamento preliminar");
    expect((await ler(cruzado.id)).source, "o dia de outra empresa não vem").toBe("Levantamento preliminar");
    expect(await ler(outra.id)).toEqual({ source: "Torno CNC", monitoringData: "Dosimetria anual" });

    const descricao = (await prisma.action.findUniqueOrThrow({ where: { id: acao.id }, select: { description: true } })).description;
    expect(descricao).toBe(
      `Origem: levantamento preliminar, sem medida imediata (NR-1 1.5.4.2.1.3).\nPerigo: Antigo adiado ${SUFIXO}`,
    );
  });
});

describe("a impressão do documento do PGR [B3-2-C]", () => {
  const css = readFileSync(join(RAIZ, "client", "src", "pages", "document-view.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ");
  const impressao = css.slice(css.indexOf("@media print"));

  it("nome, cargo e registro de quem assina, cada um na sua linha", () => {
    expect(impressao).toContain(".doc-signer > * { display: block; }");
  });

  it("o fundo da página é branco, sem o bege da aplicação embaixo do último bloco, em toda impressão", () => {
    const shell = readFileSync(join(RAIZ, "client", "src", "layout", "shell.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\s+/g, " ");
    expect(shell.slice(shell.indexOf("@media print"))).toContain("html, body, #root { background: #fff !important; }");
  });

  it("o título não fica sozinho no pé da página", () => {
    expect(impressao).toContain(".doc-paper h2, .doc-paper h3 { break-after: avoid; }");
  });
});
