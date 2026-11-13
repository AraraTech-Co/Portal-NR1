import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * A unidade é obrigatória no registro da ocorrência (decisão do Léo, 13/11),
 * e a tela já abre com a filial da ficha de quem registra: a sessão diz qual.
 *
 * Empresa própria do teste com a Loja A e a Loja B. A Ana trabalha na A; o
 * Gil gere a A; a Sara é do SST. Apagada no fim.
 */
const SUFIXO = Date.now().toString(36);
const SENHA = ["ocorr", "unidade", "obrig"].join("-");
const as = (t: string) => ({ Authorization: `Bearer ${t}` });

let app: Express;
let orgId = "";
let contaId = "";
let lojaA = "";
let lojaB = "";
const usuarios: string[] = [];
const token: Record<string, string> = {};

async function pessoa(nome: string, role: Role, loja: string | null, gere?: string) {
  const login = `ocu.${nome.toLowerCase()}.${SUFIXO}`;
  const user = await prisma.user.create({ data: { login, name: `${nome} ${SUFIXO}`, passwordHash: await bcrypt.hash(SENHA, 4) } });
  usuarios.push(user.id);
  const m = await prisma.membership.create({ data: { userId: user.id, organizationId: orgId, role } });
  await prisma.accountMembership.create({ data: { accountId: contaId, userId: user.id, role: AccountRole.USER } });
  if (loja) await prisma.employeeProfile.create({ data: { organizationId: orgId, userId: user.id, establishmentId: loja } });
  if (gere) {
    await prisma.managedEstablishment.create({
      data: { organizationId: orgId, membershipId: m.id, establishmentId: gere, createdById: user.id },
    });
  }
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  token[nome] = res.body.token;
}

const registrar = (quem: string, extra: Record<string, unknown>) =>
  request(app)
    .post("/api/occurrences")
    .set(as(token[quem]!))
    .send({ type: "DANGEROUS_EVENT", description: `Piso molhado ${SUFIXO}`, occurred_at: "2026-11-12", ...extra });

beforeAll(async () => {
  app = createApp();
  orgId = (await prisma.organization.create({ data: { name: `OCU ${SUFIXO}` } })).id;
  contaId = (await prisma.account.create({ data: { organizationId: orgId, name: `Conta OCU ${SUFIXO}` } })).id;
  lojaA = (await prisma.establishment.create({ data: { organizationId: orgId, name: `Loja A ${SUFIXO}` } })).id;
  lojaB = (await prisma.establishment.create({ data: { organizationId: orgId, name: `Loja B ${SUFIXO}` } })).id;
  await pessoa("Ana", Role.COLABORADOR, lojaA);
  await pessoa("Gil", Role.GERENTE, lojaA, lojaA);
  await pessoa("Sara", Role.SST, null);
});

afterAll(async () => {
  if (!orgId) return;
  await prisma.notification.deleteMany({ where: { organizationId: orgId } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.occurrence.deleteMany({ where: { organizationId: orgId } });
  await prisma.managedEstablishment.deleteMany({ where: { organizationId: orgId } });
  await prisma.employeeProfile.deleteMany({ where: { organizationId: orgId } });
  await prisma.accountMembership.deleteMany({ where: { accountId: contaId } });
  await prisma.membership.deleteMany({ where: { organizationId: orgId } });
  await prisma.token.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.establishment.deleteMany({ where: { organizationId: orgId } });
  await prisma.account.deleteMany({ where: { id: contaId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
});

describe("a ocorrência tem unidade", () => {
  it("a sessão diz a filial da ficha; sem ficha, nenhuma", async () => {
    const ana = await request(app).get("/api/auth").set(as(token.Ana!));
    expect(ana.body.user.work_unit).toBe(lojaA);
    const sara = await request(app).get("/api/auth").set(as(token.Sara!));
    expect(sara.body.user.work_unit).toBeNull();
  });

  it("sem unidade é recusada, para todo papel, e nada é gravado", async () => {
    for (const quem of ["Ana", "Gil", "Sara"]) {
      const res = await registrar(quem, {});
      expect(res.status, quem).toBe(400);
      expect(res.body.message, quem).toBe("Escolha o estabelecimento onde aconteceu.");
    }
    expect(await prisma.occurrence.count({ where: { organizationId: orgId } })).toBe(0);
  });

  it("a Ana registra na filial dela, e o gestor da filial a vê", async () => {
    const res = await registrar("Ana", { establishment_id: lojaA });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.occurrence.establishmentId).toBe(lojaA);
    const doGil = await request(app).get("/api/occurrences").set(as(token.Gil!));
    expect(doGil.status).toBe(200);
    expect((doGil.body.occurrences as { id: string }[]).map((o) => o.id)).toContain(res.body.occurrence.id);
  });

  it("a Ana não registra em outra filial; o SST registra em qualquer uma", async () => {
    const fora = await registrar("Ana", { establishment_id: lojaB });
    expect(fora.status).toBe(400);
    expect(fora.body.message).toBe("Estabelecimento inválido.");
    expect((await registrar("Sara", { establishment_id: lojaB })).status).toBe(201);
  });
});
