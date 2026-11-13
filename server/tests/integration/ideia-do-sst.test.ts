import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O SST, que só lê Ideias, envia a própria ideia; quem não lê o módulo, não.
 * Decisão P-0b do Léo: a ideia sim; o banco de horas não, porque o SST é
 * terceirizado. [C4-16]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
const as = (t: string) => ({ Authorization: `Bearer ${t}` });

let app: Express;
const token: Record<string, string> = {};
const criadas: string[] = [];

beforeAll(async () => {
  app = createApp();
  for (const p of ["sst", "fiscal", "colaborador"]) {
    const res = await request(app).post("/api/auth").send({ login: `teste.${p}`, password: SENHA, establishment_id: "externo" });
    expect(res.status).toBe(200);
    token[p] = res.body.token;
  }
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: criadas } } });
  await prisma.idea.deleteMany({ where: { id: { in: criadas } } });
});

describe("a ideia do SST [C4-16]", () => {
  it("o SST envia a própria ideia, gravada em nome dele", async () => {
    const res = await request(app)
      .post("/api/ideas")
      .set(as(token.sst!))
      .send({ title: `Ideia do SST ${SUFIXO}`, description: "Sinalizar a saída de emergência do estoque." });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    criadas.push(res.body.idea.id);
    const ideia = await prisma.idea.findUniqueOrThrow({ where: { id: res.body.idea.id }, include: { author: { select: { login: true } } } });
    expect(ideia.author?.login).toBe("teste.sst");
  });

  it("o SST não edita a ideia de outra pessoa; o fiscal, que não lê Ideias, não envia", async () => {
    const outra = await request(app)
      .post("/api/ideas")
      .set(as(token.colaborador!))
      .send({ title: `Ideia do colaborador ${SUFIXO}`, description: "Uma ideia de outra pessoa." });
    expect(outra.status).toBe(201);
    criadas.push(outra.body.idea.id);
    const edita = await request(app).patch(`/api/ideas/${outra.body.idea.id}`).set(as(token.sst!)).send({ title: "Mudei" });
    expect(edita.status).toBe(403);
    const fiscal = await request(app).post("/api/ideas").set(as(token.fiscal!)).send({ title: "X", description: "Y" });
    expect(fiscal.status).toBe(403);
  });
});
