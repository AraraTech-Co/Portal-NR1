import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O documento do PGR emitido abre inteiro, para imprimir e salvar. [S2-C]
 *
 * Exige a organização do `scripts/seed-teste-org.ts` e o seed principal
 * (`admin` / `admin123`) para o teste entre organizações.
 */
const SENHA = "teste1234";

async function entrar(app: Express, login: string, password = SENHA) {
  const res = await request(app).post("/api/auth").send({ login, password });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body.token as string;
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let sst: string;
let supervisor: string;
let outraOrg: string;

beforeAll(async () => {
  app = createApp();
  sst = await entrar(app, "teste.sst");
  supervisor = await entrar(app, "teste.supervisor");
  outraOrg = await entrar(app, "admin", "admin123");
});

async function emitir(type: string) {
  const res = await request(app)
    .post("/api/pgr-documents")
    .set(as(sst))
    .send({ type, responsible_name: "Técnico Responsável", responsible_role: "Técnico de SST" });
  expect(res.status).toBe(201);
  return res.body.document as { id: string; version: number };
}

describe("documento do PGR emitido abre [S2-C]", () => {
  it("o inventário volta com o retrato assinado, quem emitiu e a empresa", async () => {
    const emitido = await emitir("INVENTORY");
    const res = await request(app).get(`/api/pgr-documents/${emitido.id}`).set(as(supervisor));
    expect(res.status).toBe(200);
    const doc = res.body.document;
    expect(doc.type).toBe("INVENTORY");
    expect(doc.version).toBe(emitido.version);
    expect(Array.isArray(doc.content.items)).toBe(true);
    expect(doc.issuedBy.name).toBeTruthy();
    expect(doc.organization.name).toBeTruthy();
    expect(doc.responsibleName).toBe("Técnico Responsável");
    expect(doc.signatureStatement).toBeTruthy();
  });

  it("o plano de ação também abre", async () => {
    const emitido = await emitir("ACTION_PLAN");
    const res = await request(app).get(`/api/pgr-documents/${emitido.id}`).set(as(supervisor));
    expect(res.status).toBe(200);
    expect(res.body.document.type).toBe("ACTION_PLAN");
  });

  /*
    Os critérios não se emitem mais à parte — vão no inventário — mas os
    emitidos antes continuam abrindo: histórico não se apaga. [B3-4-J]
  */
  it("os critérios emitidos antes continuam abrindo", async () => {
    const qualquer = await emitir("INVENTORY");
    const base = await prisma.pgrDocument.findUniqueOrThrow({ where: { id: qualquer.id } });
    const antigo = await prisma.pgrDocument.create({
      data: {
        organizationId: base.organizationId,
        type: "CRITERIA",
        version: 1000 + Math.floor(Math.random() * 100000),
        content: { generated_at: new Date().toISOString(), methodologies: [] },
        issuedById: base.issuedById,
        responsibleName: "Técnico Responsável",
        signatureStatement: base.signatureStatement,
      },
    });
    try {
      const res = await request(app).get(`/api/pgr-documents/${antigo.id}`).set(as(supervisor));
      expect(res.status).toBe(200);
      expect(res.body.document.type).toBe("CRITERIA");
    } finally {
      await prisma.pgrDocument.delete({ where: { id: antigo.id } });
    }
  });

  it("outra organização não acha o documento; sem login, nada", async () => {
    const emitido = await emitir("ACTION_PLAN");
    const outra = await request(app).get(`/api/pgr-documents/${emitido.id}`).set(as(outraOrg));
    expect(outra.status).toBe(404);
    const anonimo = await request(app).get(`/api/pgr-documents/${emitido.id}`);
    expect(anonimo.status).toBe(401);
  });
});
