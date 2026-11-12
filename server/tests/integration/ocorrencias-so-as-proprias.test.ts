import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Ocorrências: o colaborador vê só as que ele relatou (decisão P-5 do Léo,
 * opção c). Quem administra e o fiscal continuam vendo as da unidade. [C4-14]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const FILIAL = "aaaaaaaa-0001-4000-8000-000000000011";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
const token: Record<string, string> = {};
let riscoId = "";
let minha = "";
let alheia = "";

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA, establishment_id: "externo" });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body.token as string;
}

async function relatar(quem: string, descricao: string) {
  const res = await request(app)
    .post("/api/occurrences")
    .set(as(token[quem]!))
    .send({
      type: "DANGEROUS_EVENT",
      description: descricao,
      occurred_at: "2026-11-10T14:30:00.000Z",
      establishment_id: FILIAL,
      risk_id: riscoId,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.occurrence.id as string;
}

beforeAll(async () => {
  app = createApp();
  for (const p of ["colaborador", "sst", "fiscal"]) token[p] = await entrar(`teste.${p}`);
  riscoId = (
    await prisma.risk.findFirstOrThrow({
      where: { organizationId: ORG_ID, archivedAt: null, hazard: { activity: { establishmentId: FILIAL } } },
      select: { id: true },
    })
  ).id;
  minha = await relatar("colaborador", `Minha ocorrência ${SUFIXO}`);
  alheia = await relatar("sst", `Ocorrência do SST ${SUFIXO}`);
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: [minha, alheia] } } });
  await prisma.occurrence.deleteMany({ where: { id: { in: [minha, alheia] } } });
});

describe("o colaborador vê só as ocorrências que relatou [C4-14]", () => {
  it("na lista, só a dele; a do colega da mesma unidade não aparece", async () => {
    const res = await request(app).get("/api/occurrences").set(as(token.colaborador!));
    expect(res.status).toBe(200);
    const ids = res.body.occurrences.map((o: { id: string }) => o.id);
    expect(ids).toContain(minha);
    expect(ids).not.toContain(alheia);
    expect(res.body.occurrences.every((o: { reportedBy: { id: string } }) => o.reportedBy.id === res.body.occurrences[0].reportedBy.id)).toBe(true);
  });

  it("a do colega responde como inexistente; a dele abre", async () => {
    expect((await request(app).get(`/api/occurrences/${minha}`).set(as(token.colaborador!))).status).toBe(200);
    const res = await request(app).get(`/api/occurrences/${alheia}`).set(as(token.colaborador!));
    expect(res.status).toBe(404);
  });

  it("no histórico do risco, só a dele", async () => {
    const res = await request(app).get(`/api/risks/${riscoId}/historico`).set(as(token.colaborador!));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const texto = JSON.stringify(res.body);
    expect(texto).toContain(`Minha ocorrência ${SUFIXO}`);
    expect(texto).not.toContain(`Ocorrência do SST ${SUFIXO}`);
  });

  it("o SST e o fiscal veem as duas, com o nome de quem relatou", async () => {
    for (const p of ["sst", "fiscal"]) {
      const res = await request(app).get("/api/occurrences").set(as(token[p]!));
      expect(res.status, p).toBe(200);
      const ids = res.body.occurrences.map((o: { id: string }) => o.id);
      expect(ids, p).toEqual(expect.arrayContaining([minha, alheia]));
      expect((await request(app).get(`/api/occurrences/${minha}`).set(as(token[p]!))).body.occurrence.reportedBy.name, p).toBeTruthy();
    }
  });
});
