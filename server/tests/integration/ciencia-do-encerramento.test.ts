import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Ciência de quem denunciou no encerramento. [C1-5]
 *
 * Pelo protocolo e código, como o acompanhamento: vale para a anônima e não
 * grava identidade [ADR-16]. Uma vez só, com comentário opcional. O comitê
 * vê a data no detalhe. A denúncia identificada, ao ser encerrada, avisa
 * quem relatou.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const EST_ID = "aaaaaaaa-0001-4000-8000-000000000011";
const SENHA = "teste1234";

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let master: { token: string };
let colaborador: { token: string; user: { id: string } };
const relatos: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

async function denunciar(opts: { identificada?: boolean } = {}) {
  const req = request(app).post("/api/ethics-reports");
  if (opts.identificada) req.set(as(colaborador.token));
  const res = await req.send({
    organization_id: ORG_ID,
    establishment_id: EST_ID,
    category: "MISCONDUCT",
    description: "Relato de teste da ciência, com mais de vinte caracteres.",
    is_anonymous: !opts.identificada,
    committee_involved: false,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  relatos.push(res.body.report.id);
  return {
    id: res.body.report.id as string,
    protocol: res.body.report.protocol as string,
    code: res.body.access_code as string,
  };
}

async function encerrar(id: string) {
  const res = await request(app)
    .patch(`/api/ethics-reports/${id}`)
    .set(as(master.token))
    .send({ status: "RESOLVED", resolution_note: "Apurado e tratado." });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

const ciencia = (protocol: string, access_code: string, comment?: string) =>
  request(app)
    .post("/api/ethics-reports/acknowledge")
    .send({ protocol, access_code, ...(comment !== undefined ? { comment } : {}) });

beforeAll(async () => {
  app = createApp();
  master = await entrar("teste.master");
  colaborador = await entrar("teste.colaborador");
  await prisma.ethicsCommitteeMember.deleteMany({ where: { organizationId: ORG_ID } });
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { entityId: { in: relatos } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: relatos } } });
  await prisma.ethicsReport.deleteMany({ where: { id: { in: relatos } } });
});

describe("ciência do encerramento [C1-5]", () => {
  it("a anônima dá ciência pelo protocolo e código, e o comitê vê a data e o comentário", async () => {
    const r = await denunciar();
    await encerrar(r.id);

    const res = await ciencia(r.protocol, r.code, "  Obrigado pelo retorno.  ");
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const acompanhamento = await request(app)
      .post("/api/ethics-reports/track")
      .send({ protocol: r.protocol, access_code: r.code });
    expect(acompanhamento.body.report.reporterAckAt).toBeTruthy();

    const detalhe = await request(app).get(`/api/ethics-reports/${r.id}`).set(as(master.token));
    expect(detalhe.body.report.reporterAckAt).toBeTruthy();
    expect(detalhe.body.report.reporterAckComment).toBe("Obrigado pelo retorno.");

    const lista = await request(app).get("/api/ethics-reports").set(as(master.token));
    const linha = lista.body.reports.find((x: { id: string }) => x.id === r.id);
    expect(linha.reporterAckAt).toBeTruthy();
  });

  it("não grava identidade: a trilha fica sem autor, e a anônima continua sem denunciante", async () => {
    const r = await denunciar();
    await encerrar(r.id);
    // Com sessão aberta, o pedido continua sem identificar ninguém.
    const res = await request(app)
      .post("/api/ethics-reports/acknowledge")
      .set(as(colaborador.token))
      .send({ protocol: r.protocol, access_code: r.code });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const trilha = await prisma.auditEvent.findFirstOrThrow({
      where: { entityId: r.id, action: "ethics_report.acknowledge" },
    });
    expect(trilha.actorId).toBeNull();
    const lido = await prisma.ethicsReport.findUniqueOrThrow({
      where: { id: r.id },
      select: { reporterUserId: true },
    });
    expect(lido.reporterUserId).toBeNull();
  });

  it("a segunda ciência é recusada e não muda a primeira", async () => {
    const r = await denunciar();
    await encerrar(r.id);
    expect((await ciencia(r.protocol, r.code, "primeira")).status).toBe(200);
    const antes = await prisma.ethicsReport.findUniqueOrThrow({
      where: { id: r.id },
      select: { reporterAckAt: true, reporterAckComment: true },
    });
    const segunda = await ciencia(r.protocol, r.code, "segunda");
    expect(segunda.status).toBe(409);
    const depois = await prisma.ethicsReport.findUniqueOrThrow({
      where: { id: r.id },
      select: { reporterAckAt: true, reporterAckComment: true },
    });
    expect(depois).toEqual(antes);
  });

  it("em denúncia não encerrada, o servidor recusa", async () => {
    const r = await denunciar();
    const res = await ciencia(r.protocol, r.code);
    expect(res.status).toBe(409);
    const lido = await prisma.ethicsReport.findUniqueOrThrow({
      where: { id: r.id },
      select: { reporterAckAt: true },
    });
    expect(lido.reporterAckAt).toBeNull();
  });

  it("código errado não dá ciência", async () => {
    const r = await denunciar();
    await encerrar(r.id);
    expect((await ciencia(r.protocol, "ERRADO1234")).status).toBe(404);
  });

  it("comentário longo demais é recusado", async () => {
    const r = await denunciar();
    await encerrar(r.id);
    const res = await ciencia(r.protocol, r.code, "x".repeat(2001));
    expect(res.status).toBe(400);
    expect(res.body.field).toBe("comment");
  });
});

describe("aviso no encerramento [C1-5]", () => {
  it("a identificada avisa quem relatou; a anônima não avisa ninguém", async () => {
    const identificada = await denunciar({ identificada: true });
    await encerrar(identificada.id);
    const aviso = await prisma.notification.findFirst({
      where: { entityId: identificada.id, kind: "ETHICS_REPORT_CLOSED" },
    });
    expect(aviso?.userId).toBe(colaborador.user.id);

    const anonima = await denunciar();
    await encerrar(anonima.id);
    expect(
      await prisma.notification.count({
        where: { entityId: anonima.id, kind: "ETHICS_REPORT_CLOSED" },
      }),
    ).toBe(0);
  });

  it("mudar de Resolvido para Arquivado não avisa de novo", async () => {
    const r = await denunciar({ identificada: true });
    await encerrar(r.id);
    await request(app)
      .patch(`/api/ethics-reports/${r.id}`)
      .set(as(master.token))
      .send({ status: "ARCHIVED" });
    expect(
      await prisma.notification.count({
        where: { entityId: r.id, kind: "ETHICS_REPORT_CLOSED" },
      }),
    ).toBe(1);
  });
});
