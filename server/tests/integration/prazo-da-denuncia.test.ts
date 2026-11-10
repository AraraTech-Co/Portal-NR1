import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { computeDueAt, fromZoned, zonedDate } from "../../src/helper/business-days";

/**
 * Prazo da primeira providência da denúncia. [C1-2]
 *
 * 1 dia útil para Alta, 3 para Normal, sempre contado do recebimento. A
 * primeira providência é sair de "Recebido": mudança de situação ou primeira
 * mensagem do comitê.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const EST_ID = "aaaaaaaa-0001-4000-8000-000000000011";
const SENHA = "teste1234";
const DIA = 24 * 3600_000;

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let master: { token: string; user: { id: string } };
const relatos: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

async function denunciar(category = "MISCONDUCT"): Promise<string> {
  const res = await request(app).post("/api/ethics-reports").send({
    organization_id: ORG_ID,
    establishment_id: EST_ID,
    category,
    description: "Relato de teste do prazo, com mais de vinte caracteres.",
    is_anonymous: true,
    committee_involved: false,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  relatos.push(res.body.report.id);
  return res.body.report.id as string;
}

async function detalhe(id: string) {
  const res = await request(app).get(`/api/ethics-reports/${id}`).set(as(master.token));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.report as {
    dueAt: string;
    firstActionAt: string | null;
    deadline_situation: string;
    createdAt: string;
  };
}

/** Recebida há tanto tempo — para o prazo já ter passado. */
async function recebidaHa(id: string, dias: number, severity: "HIGH" | "NORMAL") {
  const createdAt = new Date(Date.now() - dias * DIA);
  await prisma.ethicsReport.update({
    where: { id },
    data: { createdAt, dueAt: computeDueAt(createdAt, severity) },
  });
}

beforeAll(async () => {
  app = createApp();
  master = await entrar("teste.master");
  await prisma.ethicsCommitteeMember.deleteMany({ where: { organizationId: ORG_ID } });
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: relatos } } });
  await prisma.ethicsReport.deleteMany({ where: { id: { in: relatos } } });
});

describe("vencimento gravado na criação [C1-2]", () => {
  it("Alta vence em 1 dia útil e Normal em 3, contados do recebimento", async () => {
    for (const [categoria, gravidade] of [
      ["HARASSMENT_SEXUAL", "HIGH"],
      ["OTHER", "NORMAL"],
    ] as const) {
      const id = await denunciar(categoria);
      const lido = await prisma.ethicsReport.findUniqueOrThrow({
        where: { id },
        select: { createdAt: true, dueAt: true },
      });
      expect(lido.dueAt?.toISOString()).toBe(computeDueAt(lido.createdAt, gravidade).toISOString());
      const r = await detalhe(id);
      expect(r.dueAt).toBe(lido.dueAt?.toISOString());
      expect(["ON_TIME", "DUE_TODAY"]).toContain(r.deadline_situation);
      expect(r.firstActionAt).toBeNull();
    }
  });
});

describe("primeira providência [C1-2]", () => {
  it("a primeira mensagem do comitê grava o instante; a segunda não muda", async () => {
    const id = await denunciar();
    const um = await request(app)
      .post(`/api/ethics-reports/${id}/messages`)
      .set(as(master.token))
      .send({ body: "Recebemos o seu relato." });
    expect(um.status, JSON.stringify(um.body)).toBe(201);
    const primeira = (await detalhe(id)).firstActionAt;
    expect(primeira).not.toBeNull();

    await request(app)
      .post(`/api/ethics-reports/${id}/messages`)
      .set(as(master.token))
      .send({ body: "Outra mensagem." });
    const r = await detalhe(id);
    expect(r.firstActionAt).toBe(primeira);
    expect(r.deadline_situation).toBe("MET_ON_TIME");
  });

  it("mudar a situação para fora de Recebido também conta", async () => {
    const id = await denunciar();
    const res = await request(app)
      .patch(`/api/ethics-reports/${id}`)
      .set(as(master.token))
      .send({ status: "IN_ANALYSIS" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await detalhe(id)).firstActionAt).not.toBeNull();
  });

  it("depois do prazo, a providência sai como atendida com atraso", async () => {
    const id = await denunciar();
    await recebidaHa(id, 10, "NORMAL");
    expect((await detalhe(id)).deadline_situation).toBe("OVERDUE");
    await request(app)
      .patch(`/api/ethics-reports/${id}`)
      .set(as(master.token))
      .send({ status: "IN_ANALYSIS" });
    expect((await detalhe(id)).deadline_situation).toBe("MET_LATE");
  });
});

describe("ajuste de gravidade refaz o prazo a partir do recebimento [C1-2]", () => {
  it("Normal recebida há 2 dias vira Alta: o vencimento novo já passou e ela aparece atrasada", async () => {
    const id = await denunciar("OTHER");
    // Há 2 dias e meio: com 1 dia útil, o vencimento passou em qualquer dia da semana.
    await recebidaHa(id, 4, "NORMAL");
    const antes = await prisma.ethicsReport.findUniqueOrThrow({
      where: { id },
      select: { createdAt: true },
    });
    const ajuste = await request(app)
      .post(`/api/ethics-reports/${id}/gravidade`)
      .set(as(master.token))
      .send({ severity: "HIGH", reason: "Relato de violência." });
    expect(ajuste.status, JSON.stringify(ajuste.body)).toBe(200);
    const r = await detalhe(id);
    expect(r.dueAt).toBe(computeDueAt(antes.createdAt, "HIGH").toISOString());
    expect(r.deadline_situation).toBe("OVERDUE");
  });
});

describe("denúncias anteriores ao prazo [C1-2]", () => {
  it("sem dueAt gravado, o vencimento sai do createdAt", async () => {
    const id = await denunciar();
    const lido = await prisma.ethicsReport.update({
      where: { id },
      data: { dueAt: null },
      select: { createdAt: true },
    });
    expect((await detalhe(id)).dueAt).toBe(computeDueAt(lido.createdAt, "NORMAL").toISOString());
  });

  it("fora de Recebido e sem registro de quando: não apurada", async () => {
    const id = await denunciar();
    await prisma.ethicsReport.update({
      where: { id },
      data: { status: "IN_ANALYSIS", firstActionAt: null },
    });
    expect((await detalhe(id)).deadline_situation).toBe("NOT_ASSESSED");
  });

  it("a migração preenche a primeira providência pela menor data entre mensagem e trilha", async () => {
    const sql = readFileSync(
      join(__dirname, "../../../prisma/migrations/20261106010000_prazo_da_denuncia/migration.sql"),
      "utf8",
    );
    const update = sql.slice(sql.indexOf("UPDATE"));
    expect(update.startsWith("UPDATE")).toBe(true);

    const mensagemDepois = await denunciar();
    const trilhaDepois = await denunciar();
    const semNada = await denunciar();
    const t1 = new Date("2026-10-01T12:00:00Z");
    const t2 = new Date("2026-10-02T12:00:00Z");
    for (const id of [mensagemDepois, trilhaDepois, semNada]) {
      await prisma.ethicsReport.update({
        where: { id },
        data: { status: "IN_ANALYSIS", firstActionAt: null },
      });
    }
    // A situação mudou antes da primeira mensagem.
    await prisma.auditEvent.create({
      data: {
        organizationId: ORG_ID,
        action: "ethics_report.update_status",
        entityType: "EthicsReport",
        entityId: mensagemDepois,
        after: { status: "IN_ANALYSIS" },
        createdAt: t1,
      },
    });
    await prisma.ethicsReportMessage.create({
      data: { reportId: mensagemDepois, side: "COMMITTEE", body: "Oi", createdAt: t2 },
    });
    // A mensagem veio antes; a trilha registra uma volta a Recebido, que não conta.
    await prisma.ethicsReportMessage.create({
      data: { reportId: trilhaDepois, side: "COMMITTEE", body: "Oi", createdAt: t1 },
    });
    await prisma.auditEvent.create({
      data: {
        organizationId: ORG_ID,
        action: "ethics_report.update_status",
        entityType: "EthicsReport",
        entityId: trilhaDepois,
        after: { status: "RECEIVED" },
        createdAt: new Date("2026-09-01T12:00:00Z"),
      },
    });

    await prisma.$executeRawUnsafe(update);

    const lidos = await prisma.ethicsReport.findMany({
      where: { id: { in: [mensagemDepois, trilhaDepois, semNada] } },
      select: { id: true, firstActionAt: true },
    });
    const por = new Map(lidos.map((r) => [r.id, r.firstActionAt?.toISOString() ?? null]));
    expect(por.get(mensagemDepois)).toBe(t1.toISOString());
    expect(por.get(trilhaDepois)).toBe(t1.toISOString());
    expect(por.get(semNada)).toBeNull();
    expect((await detalhe(semNada)).deadline_situation).toBe("NOT_ASSESSED");
  });
});

describe("Início de quem é do comitê [C1-2]", () => {
  it("conta as atrasadas e as que vencem hoje", async () => {
    const atrasada = await denunciar();
    await recebidaHa(atrasada, 10, "NORMAL");
    const venceHoje = await denunciar();
    await prisma.ethicsReport.update({
      where: { id: venceHoje },
      // 23:59:59 de hoje em Brasília: ainda não passou, e é hoje.
      data: { dueAt: fromZoned({ ...zonedDate(new Date()), hour: 23, minute: 59, second: 59, ms: 0 }) },
    });

    const res = await request(app).get("/api/inicio").set(as(master.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const texto = JSON.stringify(res.body);
    expect(texto).toContain("denuncias_atrasadas");
    expect(texto).toContain("denuncias_vencem_hoje");
  });
});
