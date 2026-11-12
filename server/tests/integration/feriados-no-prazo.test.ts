import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { computeDueAt, fromZoned } from "../../src/helper/business-days";
import { holidayCalendarFor } from "../../src/helper/ethics-deadline";

/**
 * Feriados da empresa e da filial no prazo da denúncia. [C4-11]
 *
 * Na organização do `scripts/seed-teste-org.ts`, duas filiais do teste (A e
 * B). Os feriados "dos próximos dias" cobrem 12 dias corridos, para o teste
 * não depender do dia da semana em que roda.
 *
 * Feriados, filiais e denúncias do teste são apagados no fim.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const DIA = 24 * 3600_000;
const SUFIXO = Date.now().toString(36);
const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh = "";
let sst = "";
let master = "";
let filialA = "";
let filialB = "";
const relatos: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body.token as string;
}

async function denunciar(establishment_id: string, category = "OTHER") {
  const res = await request(app).post("/api/ethics-reports").send({
    organization_id: ORG_ID,
    establishment_id,
    category,
    description: "Relato de teste dos feriados, com mais de vinte caracteres.",
    is_anonymous: true,
    committee_involved: false,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  relatos.push(res.body.report.id);
  return prisma.ethicsReport.findUniqueOrThrow({
    where: { id: res.body.report.id },
    select: { id: true, createdAt: true, dueAt: true },
  });
}

/** Feriados não repetidos nos próximos 12 dias, na filial ou na empresa. */
async function proximosDias(establishment_id: string | null, nome: string) {
  for (let i = 0; i <= 12; i++) {
    const d = new Date(Date.now() + i * DIA).toISOString().slice(0, 10);
    const res = await request(app)
      .post("/api/feriados")
      .set(as(rh))
      .send({ date: d, name: `${nome} ${i}`, recurring: false, establishment_id });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  }
}

beforeAll(async () => {
  app = createApp();
  rh = await entrar("teste.rh");
  sst = await entrar("teste.sst");
  master = await entrar("teste.master");
  filialA = (await prisma.establishment.create({ data: { organizationId: ORG_ID, name: `Feriado A ${SUFIXO}` } })).id;
  filialB = (await prisma.establishment.create({ data: { organizationId: ORG_ID, name: `Feriado B ${SUFIXO}` } })).id;
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: [...relatos, filialA, filialB] } } });
  await prisma.ethicsReportSeverityChange.deleteMany({ where: { reportId: { in: relatos } } });
  await prisma.ethicsReport.deleteMany({ where: { id: { in: relatos } } });
  const feriados = await prisma.holiday.findMany({ where: { organizationId: ORG_ID }, select: { id: true } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: feriados.map((f) => f.id) } } });
  await prisma.holiday.deleteMany({ where: { organizationId: ORG_ID } });
  await prisma.establishment.deleteMany({ where: { id: { in: [filialA, filialB] } } });
});

describe("quem cadastra feriado [C4-11]", () => {
  it("RH lê e cadastra; SST não", async () => {
    expect((await request(app).get("/api/feriados").set(as(rh))).status).toBe(200);
    expect((await request(app).get("/api/feriados").set(as(sst))).status).toBe(403);
    expect(
      (await request(app).post("/api/feriados").set(as(sst)).send({ date: "2027-01-25", name: "X" })).status,
    ).toBe(403);
  });

  it("data que não existe, sem nome ou filial de outra empresa voltam com o motivo", async () => {
    const semDia = await request(app).post("/api/feriados").set(as(rh)).send({ date: "2027-02-30", name: "Errado" });
    expect(semDia.status).toBe(400);
    expect(semDia.body.message).toBe("Data do feriado inválida — esse dia não existe. Use dd/mm/aaaa.");
    expect((await request(app).post("/api/feriados").set(as(rh)).send({ date: "2027-01-25", name: " " })).status).toBe(400);
    const outra = await prisma.establishment.findFirstOrThrow({
      where: { organizationId: { not: ORG_ID } },
      select: { id: true },
    });
    const res = await request(app)
      .post("/api/feriados")
      .set(as(rh))
      .send({ date: "2027-01-25", name: "Alheio", establishment_id: outra.id });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Filial inválida.");
  });

  it("a filial nasce com a Sexta-feira Santa ligada e o Corpus Christi desligado", async () => {
    const res = await request(app).get("/api/feriados").set(as(rh));
    expect(res.body.filiais.find((f: { id: string }) => f.id === filialA)).toMatchObject({
      good_friday: true,
      corpus_christi: false,
    });
  });
});

describe("o prazo da denúncia usa os feriados da filial e da empresa [C4-11]", () => {
  it("Alta numa quinta-feira santa vence na segunda com a Sexta-feira Santa ligada, e na sexta com ela desligada", async () => {
    const res = await request(app).patch(`/api/feriados/filiais/${filialB}`).set(as(rh)).send({ good_friday: false });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.filial).toMatchObject({ good_friday: false });
    // 25/03/2027 é a quinta-feira santa (Páscoa em 28/03/2027).
    const quintaSanta = fromZoned({ year: 2027, month: 3, day: 25, hour: 10, minute: 0, second: 0, ms: 0 });
    const ligada = computeDueAt(quintaSanta, "HIGH", await holidayCalendarFor(ORG_ID, filialA));
    const desligada = computeDueAt(quintaSanta, "HIGH", await holidayCalendarFor(ORG_ID, filialB));
    expect(ligada.toISOString()).toBe(fromZoned({ year: 2027, month: 3, day: 29, hour: 10, minute: 0, second: 0, ms: 0 }).toISOString());
    expect(desligada.toISOString()).toBe(fromZoned({ year: 2027, month: 3, day: 26, hour: 10, minute: 0, second: 0, ms: 0 }).toISOString());
  });

  it("feriado da filial A só afeta as denúncias novas da filial A", async () => {
    await proximosDias(filialA, "Festa de A");
    const deA = await denunciar(filialA);
    const deB = await denunciar(filialB);
    expect(deA.dueAt!.getTime() - deA.createdAt.getTime()).toBeGreaterThan(12 * DIA);
    expect(deB.dueAt!.getTime() - deB.createdAt.getTime()).toBeLessThan(6 * DIA);
    expect(deA.dueAt!.toISOString()).toBe(
      computeDueAt(deA.createdAt, "NORMAL", await holidayCalendarFor(ORG_ID, filialA)).toISOString(),
    );
  });

  it("cadastrar feriado não muda denúncia aberta; feriado da empresa vale para as novas de todas as filiais", async () => {
    const aberta = await denunciar(filialB);
    await proximosDias(null, "Festa da empresa");
    const depois = await prisma.ethicsReport.findUniqueOrThrow({ where: { id: aberta.id }, select: { dueAt: true } });
    expect(depois.dueAt!.toISOString()).toBe(aberta.dueAt!.toISOString());
    const detalhe = await request(app).get(`/api/ethics-reports/${aberta.id}`).set(as(master));
    expect(detalhe.body.report.dueAt).toBe(aberta.dueAt!.toISOString());

    const nova = await denunciar(filialB);
    expect(nova.dueAt!.getTime() - nova.createdAt.getTime()).toBeGreaterThan(12 * DIA);
  });

  it("o ajuste de gravidade refaz o prazo pelo calendário da filial da denúncia", async () => {
    const r = await denunciar(filialA);
    const ajuste = await request(app)
      .post(`/api/ethics-reports/${r.id}/gravidade`)
      .set(as(master))
      .send({ severity: "HIGH", reason: "Relato de violência." });
    expect(ajuste.status, JSON.stringify(ajuste.body)).toBe(200);
    const depois = await prisma.ethicsReport.findUniqueOrThrow({ where: { id: r.id }, select: { dueAt: true } });
    expect(depois.dueAt!.toISOString()).toBe(
      computeDueAt(r.createdAt, "HIGH", await holidayCalendarFor(ORG_ID, filialA)).toISOString(),
    );
    expect(depois.dueAt!.getTime() - r.createdAt.getTime()).toBeGreaterThan(12 * DIA);
  });

  it("excluir o feriado: as denúncias novas voltam a contar sem ele", async () => {
    const lista = await request(app).get("/api/feriados").set(as(rh));
    for (const f of lista.body.feriados as { id: string }[]) {
      expect((await request(app).delete(`/api/feriados/${f.id}`).set(as(rh))).status).toBe(204);
    }
    const nova = await denunciar(filialA);
    expect(nova.dueAt!.getTime() - nova.createdAt.getTime()).toBeLessThan(6 * DIA);
  });
});
