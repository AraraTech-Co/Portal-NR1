import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * "Nova função" e o renomear em Operação avisam a função equivalente da
 * mesma filial (Correção 6, C6-5).
 *
 * Empresa própria do teste:
 * - a Loja tem o setor "Frente" com Repositor e Caixa, e o setor "Depósito";
 * - "COM OP CAIXA" é apelido da Caixa na Loja;
 * - a AG tem o setor "Escritório", vazio;
 * - na Loja há também "Antiga", arquivada, que não conta.
 *
 * Apagada no fim.
 */
const SUFIXO = Date.now().toString(36);
const SENHA = ["funcao", "equivalente"].join("-");
const as = (t: string) => ({ Authorization: `Bearer ${t}` });

let app: Express;
let orgId = "";
let contaId = "";
let mia = "";
let usuario = "";
let frente = "";
let deposito = "";
let escritorio = "";
let repositor = "";
let caixa = "";

const nova = (sectorId: string, name: string, confirmar = false) =>
  request(app)
    .post("/api/job-roles")
    .set(as(mia))
    .send({ sector_id: sectorId, name, ...(confirmar ? { confirmar_equivalente: true } : {}) });
const renomear = (id: string, name: string, confirmar = false) =>
  request(app)
    .patch(`/api/job-roles/${id}`)
    .set(as(mia))
    .send({ name, ...(confirmar ? { confirmar_equivalente: true } : {}) });
const quantas = () => prisma.jobRole.count({ where: { organizationId: orgId, archivedAt: null } });

beforeAll(async () => {
  app = createApp();
  orgId = (await prisma.organization.create({ data: { name: `EQV ${SUFIXO}` } })).id;
  contaId = (await prisma.account.create({ data: { organizationId: orgId, name: `Conta EQV ${SUFIXO}` } })).id;
  const loja = (await prisma.establishment.create({ data: { organizationId: orgId, name: `Loja ${SUFIXO}` } })).id;
  const ag = (await prisma.establishment.create({ data: { organizationId: orgId, name: `AG ${SUFIXO}` } })).id;
  frente = (await prisma.sector.create({ data: { organizationId: orgId, establishmentId: loja, name: "Frente" } })).id;
  deposito = (await prisma.sector.create({ data: { organizationId: orgId, establishmentId: loja, name: "Depósito" } })).id;
  escritorio = (await prisma.sector.create({ data: { organizationId: orgId, establishmentId: ag, name: "Escritório" } })).id;
  repositor = (await prisma.jobRole.create({ data: { organizationId: orgId, sectorId: frente, name: "Repositor" } })).id;
  caixa = (await prisma.jobRole.create({ data: { organizationId: orgId, sectorId: frente, name: "Caixa" } })).id;
  await prisma.jobRole.create({
    data: { organizationId: orgId, sectorId: frente, name: "Antiga", archivedAt: new Date() },
  });

  const login = `eqv.mia.${SUFIXO}`;
  const user = await prisma.user.create({ data: { login, name: `Mia ${SUFIXO}`, passwordHash: await bcrypt.hash(SENHA, 4) } });
  usuario = user.id;
  await prisma.membership.create({ data: { userId: user.id, organizationId: orgId, role: Role.MASTER } });
  await prisma.accountMembership.create({ data: { accountId: contaId, userId: user.id, role: AccountRole.USER } });
  await prisma.jobRoleAlias.create({
    data: { organizationId: orgId, establishmentId: loja, chave: "com op caixo", grafia: "COM OP CAIXA", jobRoleId: caixa, createdById: user.id },
  });
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  mia = res.body.token;
});

afterAll(async () => {
  if (!orgId) return;
  await prisma.auditEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.jobRoleAlias.deleteMany({ where: { organizationId: orgId } });
  await prisma.accountMembership.deleteMany({ where: { accountId: contaId } });
  await prisma.membership.deleteMany({ where: { organizationId: orgId } });
  await prisma.token.deleteMany({ where: { userId: usuario } });
  await prisma.user.deleteMany({ where: { id: usuario } });
  await prisma.jobRole.deleteMany({ where: { organizationId: orgId } });
  await prisma.sector.deleteMany({ where: { organizationId: orgId } });
  await prisma.establishment.deleteMany({ where: { organizationId: orgId } });
  await prisma.account.deleteMany({ where: { id: contaId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
});

describe("criar função equivalente na mesma filial [C6-5]", () => {
  it("Repositora, em outro setor da filial que tem Repositor: 409 com o aviso, e nada criado", async () => {
    const antes = await quantas();
    const res = await nova(deposito, "Repositora");
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      message: 'Já existe "Repositor" no setor Frente. Criar mesmo assim?',
      code: "funcao_equivalente",
    });
    expect(await quantas()).toBe(antes);
  });

  it("confirmado, cria", async () => {
    const res = await nova(deposito, "Repositora", true);
    expect(res.status).toBe(201);
    expect(res.body.job_role.name).toBe("Repositora");
    await prisma.jobRole.update({ where: { id: res.body.job_role.id }, data: { archivedAt: new Date() } });
  });

  it("Repositor em outra filial: sem aviso", async () => {
    const res = await nova(escritorio, "Repositor");
    expect(res.status).toBe(201);
  });

  it("o nome que a folha já usa como apelido avisa, dizendo de quem é", async () => {
    const res = await nova(deposito, "Com Op Caixa");
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(
      'Já existe "Caixa" no setor Frente, que a folha chama de "Com Op Caixa". Criar mesmo assim?',
    );
  });

  it("a função arquivada não conta", async () => {
    const res = await nova(deposito, "Antigo");
    expect(res.status).toBe(201);
  });
});

describe("renomear para uma equivalente [C6-5]", () => {
  it("Caixa para Repositora: 409, e o nome fica", async () => {
    const res = await renomear(caixa, "Repositora");
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Já existe "Repositor" no setor Frente. Renomear mesmo assim?');
    expect((await prisma.jobRole.findUniqueOrThrow({ where: { id: caixa } })).name).toBe("Caixa");
  });

  it("trocar só maiúscula ou acento do próprio nome não avisa", async () => {
    const res = await renomear(repositor, "REPOSITOR");
    expect(res.status).toBe(200);
    expect(res.body.job_role.name).toBe("REPOSITOR");
  });

  it("renomear para o apelido da própria função não avisa", async () => {
    const res = await renomear(caixa, "Com Op Caixa");
    expect(res.status).toBe(200);
    await renomear(caixa, "Caixa");
  });

  it("com duas equivalentes já cadastradas, trocar só a grafia de uma não avisa", async () => {
    const par = await prisma.jobRole.create({ data: { organizationId: orgId, sectorId: deposito, name: "Repositora" } });
    const res = await renomear(par.id, "REPOSITORA");
    expect(res.status).toBe(200);
    await prisma.jobRole.update({ where: { id: par.id }, data: { archivedAt: new Date() } });
  });

  it("confirmado, renomeia", async () => {
    const res = await renomear(caixa, "Repositora", true);
    expect(res.status).toBe(200);
    expect(res.body.job_role.name).toBe("Repositora");
  });
});
