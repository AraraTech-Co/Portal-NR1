import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * A ciência da ordem de serviço no papel.
 *
 * A ordem imprimia sem a ciência — era decisão de quem fez a tela ("o papel
 * é o documento, não o controle"), e o fiscal que pedisse a prova em PDF
 * ficava sem ela. Agora a lista vai como anexo e sai um comprovante por
 * pessoa para assinar; no papel, quem identifica a pessoa é a matrícula.
 * [B2-4-G] [CB-46]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let sst: string;
let fiscal: string;
let colaborador: string;
let ordem = "";

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body.token as string;
}

beforeAll(async () => {
  app = createApp();
  sst = await entrar("teste.sst");
  fiscal = await entrar("teste.fiscal");
  colaborador = await entrar("teste.colaborador");

  /*
    A ordem da função onde há gente com matrícula: o banco local tem ordens
    de funções vazias, e numa delas a lista sairia sem ninguém — a
    conferência passaria sem provar nada.
  */
  const comFicha = await prisma.employeeProfile.findFirst({
    where: {
      organizationId: ORG_ID,
      dismissedAt: null,
      registration: { not: null },
      jobRoleId: { not: null },
      user: { active: true },
    },
    select: { jobRoleId: true },
  });
  expect(comFicha?.jobRoleId, "alguém com função e matrícula no seed").toBeTruthy();

  const os = await prisma.serviceOrder.findFirst({
    where: { organizationId: ORG_ID, jobRoleId: comFicha!.jobRoleId! },
    orderBy: { issuedAt: "desc" },
    select: { id: true },
  });
  expect(os, "uma ordem de serviço dessa função no seed").toBeTruthy();
  ordem = os!.id;
});

describe("o comprovante precisa identificar a pessoa [B2-4-G]", () => {
  it("a lista de ciência traz a matrícula de cada um", async () => {
    const res = await request(app)
      .get(`/api/service-orders/${ordem}/ciencias`)
      .set(as(sst));
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const pessoas = res.body.people as Array<{
      id: string;
      name: string;
      registration: string | null;
      acknowledged_at: string | null;
    }>;
    expect(pessoas.length).toBeGreaterThan(0);
    for (const p of pessoas) {
      expect(p, "a linha da pessoa").toHaveProperty("registration");
    }
    /*
      Pelo menos uma com matrícula preenchida: se nenhuma tivesse, a
      conferência passaria sem provar que o campo chega.
    */
    expect(pessoas.some((p) => p.registration)).toBe(true);

    // A matrícula é a da ficha, não um número qualquer.
    const comMatricula = pessoas.find((p) => p.registration)!;
    const ficha = await prisma.employeeProfile.findFirst({
      where: { organizationId: ORG_ID, userId: comMatricula.id },
      select: { registration: true },
    });
    expect(comMatricula.registration).toBe(ficha?.registration);
  });

  it("a fiscalização lê a lista — é a prova que ela pede", async () => {
    const res = await request(app)
      .get(`/api/service-orders/${ordem}/ciencias`)
      .set(as(fiscal));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.people.length).toBeGreaterThan(0);
    expect(res.body.people[0]).toHaveProperty("registration");
  });

  it("quem não emite nem fiscaliza continua sem a lista", async () => {
    const res = await request(app)
      .get(`/api/service-orders/${ordem}/ciencias`)
      .set(as(colaborador));
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it("a contagem de quem deu ciência bate com o banco", async () => {
    const res = await request(app)
      .get(`/api/service-orders/${ordem}/ciencias`)
      .set(as(sst));
    const noBanco = await prisma.serviceOrderAck.count({
      where: { serviceOrderId: ordem },
    });
    const naLista = (
      res.body.people as Array<{ acknowledged_at: string | null }>
    ).filter((p) => p.acknowledged_at).length;
    expect(res.body.acknowledged).toBe(naLista);
    /*
      Quem deu ciência e depois saiu da função não aparece na lista: por
      isso "menor ou igual", e não igual.
    */
    expect(naLista).toBeLessThanOrEqual(noBanco);
  });
});
