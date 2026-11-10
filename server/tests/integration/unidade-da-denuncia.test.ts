import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * A unidade escolhida ao denunciar. [C1-3]
 *
 * O servidor já aceitava a unidade, mas a tela não perguntava, e a coluna
 * "Estabelecimento" do comitê saía sempre vazia. Agora a unidade é
 * obrigatória, conferida contra a empresa, e o canal mostra a lista para
 * quem relata escolher — só id e nome.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const EST_ID = "aaaaaaaa-0001-4000-8000-000000000011";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let master: { token: string };
let colaborador: { token: string };
const relatos: string[] = [];
let outraEmpresa: string;
let unidadeDeOutra: string;
let unidadeArquivada: string;

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string };
}

beforeAll(async () => {
  app = createApp();
  master = await entrar("teste.master");
  colaborador = await entrar("teste.colaborador");
  await prisma.ethicsCommitteeMember.deleteMany({ where: { organizationId: ORG_ID } });

  const empresa = await prisma.organization.create({
    data: { name: `Outra empresa ${SUFIXO}`, taxId: `99${Date.now()}`.slice(0, 14) },
  });
  outraEmpresa = empresa.id;
  unidadeDeOutra = (
    await prisma.establishment.create({
      data: { organizationId: outraEmpresa, name: `Filial de outra ${SUFIXO}`, address: "Rua X, 1" },
    })
  ).id;
  unidadeArquivada = (
    await prisma.establishment.create({
      data: {
        organizationId: ORG_ID,
        name: `Unidade fechada ${SUFIXO}`,
        address: "Rua Y, 2",
        archivedAt: new Date(),
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: relatos } } });
  await prisma.ethicsReport.deleteMany({ where: { id: { in: relatos } } });
  await prisma.establishment.deleteMany({ where: { id: { in: [unidadeDeOutra, unidadeArquivada] } } });
  await prisma.organization.deleteMany({ where: { id: outraEmpresa } });
});

describe("a lista de unidades do canal [C1-3]", () => {
  it("canal público com a empresa: as unidades ativas, só id e nome", async () => {
    const res = await request(app).get(`/api/ethics-reports/meta?organization_id=${ORG_ID}`);
    expect(res.status).toBe(200);
    const ids = res.body.establishments.map((e: { id: string }) => e.id);
    expect(ids).toContain(EST_ID);
    expect(ids).not.toContain(unidadeArquivada);
    expect(ids).not.toContain(unidadeDeOutra);
    for (const e of res.body.establishments) {
      expect(Object.keys(e).sort()).toEqual(["id", "name"]);
    }
  });

  it("sem empresa no endereço, nenhuma unidade sai [CB-63]", async () => {
    const res = await request(app).get("/api/ethics-reports/meta");
    expect(res.status).toBe(200);
    expect(res.body.establishments).toEqual([]);
  });

  it("dentro do portal: as unidades da empresa da sessão", async () => {
    const res = await request(app).get("/api/ethics-reports/meta").set(as(colaborador.token));
    expect(res.status).toBe(200);
    expect(res.body.establishments.map((e: { id: string }) => e.id)).toContain(EST_ID);
  });
});

describe("a unidade é obrigatória e conferida [C1-3]", () => {
  const base = {
    organization_id: ORG_ID,
    category: "MISCONDUCT",
    description: `Relato de teste da unidade ${SUFIXO}, com mais de vinte caracteres.`,
    is_anonymous: true,
    committee_involved: false,
  };

  it("sem unidade, o servidor recusa e diz qual campo faltou", async () => {
    const res = await request(app).post("/api/ethics-reports").send(base);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.field).toBe("establishment_id");
    expect(res.body.message).toMatch(/unidade/i);
  });

  it("unidade de outra empresa ou arquivada é recusada", async () => {
    for (const establishment_id of [unidadeDeOutra, unidadeArquivada]) {
      const res = await request(app)
        .post("/api/ethics-reports")
        .send({ ...base, establishment_id });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.field).toBe("establishment_id");
    }
    expect(
      await prisma.ethicsReport.count({ where: { description: base.description } }),
    ).toBe(0);
  });

  it("pelo canal público e dentro do portal, a unidade aparece na lista e no detalhe", async () => {
    const publico = await request(app)
      .post("/api/ethics-reports")
      .send({ ...base, establishment_id: EST_ID });
    expect(publico.status, JSON.stringify(publico.body)).toBe(201);
    relatos.push(publico.body.report.id);

    const portal = await request(app)
      .post("/api/ethics-reports")
      .set(as(colaborador.token))
      .send({ ...base, organization_id: undefined, establishment_id: EST_ID });
    expect(portal.status, JSON.stringify(portal.body)).toBe(201);
    relatos.push(portal.body.report.id);

    const lista = await request(app).get("/api/ethics-reports").set(as(master.token));
    for (const id of [publico.body.report.id, portal.body.report.id]) {
      const linha = lista.body.reports.find((r: { id: string }) => r.id === id);
      expect(linha?.establishment?.id, id).toBe(EST_ID);
      const detalhe = await request(app).get(`/api/ethics-reports/${id}`).set(as(master.token));
      expect(detalhe.body.report.establishment?.id).toBe(EST_ID);
    }
  });
});
