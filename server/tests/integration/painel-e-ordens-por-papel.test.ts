import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Painel da fiscalização e ordens de serviço por papel (decisão P-2 do Léo,
 * opções b e c). [C4-13]
 *
 * - O painel: Master, Dono, SST, RH e fiscal. Gerente, supervisor, ADM loja
 *   e colaborador recebem 403.
 * - Ordens de serviço: o colaborador vê só a da própria função; a de outra
 *   função responde como inexistente. Os demais papéis veem todas.
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
let outraFuncao = "";
let ordemAlheia = "";
let ordemMinha = "";

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA, establishment_id: "externo" });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body.token as string;
}

beforeAll(async () => {
  app = createApp();
  for (const p of ["master", "sst", "rh", "gerente", "supervisor", "colaborador", "fiscal"]) {
    token[p] = await entrar(`teste.${p}`);
  }
  const minha = await prisma.employeeProfile.findFirstOrThrow({
    where: { organizationId: ORG_ID, user: { login: "teste.colaborador" } },
    select: { jobRoleId: true, jobRole: { select: { sectorId: true } } },
  });
  outraFuncao = (
    await prisma.jobRole.create({
      data: { organizationId: ORG_ID, sectorId: minha.jobRole!.sectorId, name: `Outra função P2 ${SUFIXO}` },
    })
  ).id;
  for (const [funcao, alvo] of [
    [outraFuncao, "alheia"],
    [minha.jobRoleId!, "minha"],
  ] as const) {
    const res = await request(app)
      .post("/api/service-orders")
      .set(as(token.sst!))
      .send({ job_role_id: funcao, duties: "Usar os EPIs.", responsible_name: "SST P2" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    if (alvo === "alheia") ordemAlheia = res.body.service_order.id;
    else ordemMinha = res.body.service_order.id;
  }
});

afterAll(async () => {
  await prisma.serviceOrderAck.deleteMany({ where: { serviceOrderId: ordemAlheia } });
  await prisma.serviceOrder.deleteMany({ where: { jobRoleId: outraFuncao } });
  await prisma.jobRole.deleteMany({ where: { id: outraFuncao } });
});

describe("quem vê o painel da fiscalização [C4-13]", () => {
  it("Master, SST, RH e fiscal veem; gerente, supervisor e colaborador não", async () => {
    for (const p of ["master", "sst", "rh", "fiscal"]) {
      /* Filtrado por uma filial, como a tela faz: o painel da empresa inteira é lento no banco de teste. */
      expect((await request(app).get(`/api/fiscalizacao?establishment_id=${FILIAL}`).set(as(token[p]!))).status, p).toBe(200);
    }
    for (const p of ["gerente", "supervisor", "colaborador"]) {
      expect((await request(app).get(`/api/fiscalizacao?establishment_id=${FILIAL}`).set(as(token[p]!))).status, p).toBe(403);
      expect((await request(app).get("/api/fiscalizacao/historico").set(as(token[p]!))).status, p).toBe(403);
    }
  }, 90_000);
});

describe("ordens de serviço por papel [C4-13]", () => {
  it("o colaborador lista só a própria função e não abre a ordem de outra", async () => {
    const lista = await request(app).get("/api/service-orders").set(as(token.colaborador!));
    expect(lista.status).toBe(200);
    expect(lista.body.job_roles.length).toBe(1);
    expect(lista.body.job_roles[0].is_mine).toBe(true);
    expect((await request(app).get(`/api/service-orders/${ordemMinha}`).set(as(token.colaborador!))).status).toBe(200);
    const alheia = await request(app).get(`/api/service-orders/${ordemAlheia}`).set(as(token.colaborador!));
    expect(alheia.status).toBe(404);
    expect(alheia.body).toEqual({ message: "Ordem de serviço não encontrada." });
  });

  it("gerente, RH e fiscal continuam vendo todas as funções e abrindo qualquer ordem", async () => {
    for (const p of ["gerente", "rh", "fiscal"]) {
      const lista = await request(app).get("/api/service-orders").set(as(token[p]!));
      expect(lista.status, p).toBe(200);
      expect(lista.body.job_roles.some((f: { id: string }) => f.id === outraFuncao), p).toBe(true);
      expect((await request(app).get(`/api/service-orders/${ordemAlheia}`).set(as(token[p]!))).status, p).toBe(200);
    }
  }, 90_000);
});
