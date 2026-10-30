import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * "Ocorrência registrada", no Histórico do risco, traz o que aconteceu. [B4-A]
 *
 * O registro da trilha guardava só o tipo. O novo guarda a descrição e a data;
 * o antigo ganha a descrição da própria ocorrência na hora de montar o
 * histórico.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

let app: Express;
let sst: { token: string };
let risco = "";
let ocorrencia = "";

const as = () => ({ Authorization: `Bearer ${sst.token}` });

async function historico() {
  const res = await request(app).get(`/api/risks/${risco}/historico`).set(as());
  expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
  return (res.body.changes as { action: string; after: Record<string, unknown> }[]).find(
    (c) => c.action === "occurrence.create" && c.after?.description === `Peça projetada ${SUFIXO}`,
  );
}

beforeAll(async () => {
  app = createApp();
  const res = await request(app).post("/api/auth").send({ login: "teste.sst", password: SENHA });
  sst = res.body;
  risco = (
    await prisma.risk.findFirstOrThrow({
      where: { organizationId: ORG, archivedAt: null },
      select: { id: true },
    })
  ).id;
  const occ = await request(app)
    .post("/api/occurrences")
    .set(as())
    .send({
      type: "DANGEROUS_EVENT",
      description: `Peça projetada ${SUFIXO}`,
      occurred_at: "2026-10-22T13:00:00.000Z",
      risk_id: risco,
    });
  expect(occ.status, JSON.stringify(occ.body)).toBe(201);
  ocorrencia = occ.body.occurrence.id;
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { entityId: ocorrencia } });
  await prisma.occurrence.deleteMany({ where: { id: ocorrencia } });
});

describe("a ocorrência no Histórico do risco [B4-A]", () => {
  it("o registro novo guarda o que aconteceu e quando", async () => {
    const trilha = await prisma.auditEvent.findFirstOrThrow({
      where: { entityId: ocorrencia, action: "occurrence.create" },
    });
    expect(trilha.after).toMatchObject({
      type: "DANGEROUS_EVENT",
      description: `Peça projetada ${SUFIXO}`,
      occurredAt: "2026-10-22T13:00:00.000Z",
    });
    expect(await historico(), "aparece no histórico do risco").toBeTruthy();
  });

  it("o registro antigo, só com o tipo, ganha a descrição da ocorrência", async () => {
    await prisma.auditEvent.updateMany({
      where: { entityId: ocorrencia, action: "occurrence.create" },
      data: { after: { type: "DANGEROUS_EVENT" } },
    });
    const linha = await historico();
    expect(linha, "a descrição veio da ocorrência").toBeTruthy();
    expect(linha!.after.type).toBe("DANGEROUS_EVENT");
  });
});
