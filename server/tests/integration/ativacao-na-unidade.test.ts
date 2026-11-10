import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O painel "Ativação de contas" do gerente fica na unidade dele. [C3-5]
 *
 * Decisão 5 da devolutiva da C2 (10/11): o gerente vê só as pessoas das
 * unidades que gere (e a própria conta), com o recorte da C2-13. Master, Dono
 * e RH continuam vendo a empresa inteira; só eles agem.
 *
 * Empresa própria do teste, com a Loja e a AG; o gerente responde pela Loja.
 */
const SUFIXO = Date.now().toString(36);
const SENHA = ["c35", "ativacao", "unidade"].join("-");

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
const empresa = { orgId: "", contaId: "", usuarios: [] as string[] };
let loja = "";
let ag = "";
const id: Record<string, string> = {};
const token: Record<string, string> = {};

async function pessoa(nome: string, role: Role, filial: string | null | "sem-ficha") {
  const login = `c35.${nome.toLowerCase()}.${SUFIXO}`;
  const user = await prisma.user.create({
    data: { login, name: `${nome} C35`, passwordHash: await bcrypt.hash(SENHA, 4) },
  });
  empresa.usuarios.push(user.id);
  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId: empresa.orgId, role },
  });
  await prisma.accountMembership.create({
    data: { accountId: empresa.contaId, userId: user.id, role: AccountRole.USER },
  });
  if (filial !== "sem-ficha") {
    await prisma.employeeProfile.create({
      data: { organizationId: empresa.orgId, userId: user.id, registration: `${nome}-${SUFIXO}`.slice(0, 20), establishmentId: filial },
    });
  }
  id[nome] = user.id;
  return { login, membershipId: membership.id };
}

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body.token as string;
}

const painel = (t: string) => request(app).get("/api/pessoas-acessos/ativacao").set(as(t));
const quem = (body: { people: { userId: string }[] }) => body.people.map((p) => p.userId).sort();

beforeAll(async () => {
  app = createApp();
  const org = await prisma.organization.create({ data: { name: `C35 ${SUFIXO}` } });
  empresa.orgId = org.id;
  empresa.contaId = (
    await prisma.account.create({ data: { organizationId: org.id, name: `Conta C35 ${SUFIXO}` } })
  ).id;
  loja = (await prisma.establishment.create({ data: { organizationId: org.id, name: `Loja ${SUFIXO}` } })).id;
  ag = (await prisma.establishment.create({ data: { organizationId: org.id, name: `AG ${SUFIXO}` } })).id;

  const rh = await pessoa("Rita", Role.RH, "sem-ficha");
  const gerente = await pessoa("Gil", Role.GERENTE, ag);
  await pessoa("Ana", Role.COLABORADOR, loja);
  await pessoa("Bia", Role.COLABORADOR, loja);
  await pessoa("Caio", Role.COLABORADOR, ag);
  await pessoa("Davi", Role.COLABORADOR, null);
  const semUnidade = await pessoa("Gus", Role.GERENTE, loja);

  /* O Gil trabalha na AG, mas responde pela Loja. */
  await prisma.managedEstablishment.create({
    data: {
      organizationId: empresa.orgId,
      membershipId: gerente.membershipId,
      establishmentId: loja,
      createdById: id.Rita,
    },
  });
  token.rh = await entrar(rh.login);
  token.gil = await entrar(gerente.login);
  token.gus = await entrar(semUnidade.login);
});

afterAll(async () => {
  if (!empresa.orgId) return;
  await prisma.auditEvent.deleteMany({ where: { organizationId: empresa.orgId } });
  await prisma.employeeProfile.deleteMany({ where: { organizationId: empresa.orgId } });
  await prisma.managedEstablishment.deleteMany({ where: { organizationId: empresa.orgId } });
  await prisma.accountMembership.deleteMany({ where: { accountId: empresa.contaId } });
  await prisma.membership.deleteMany({ where: { organizationId: empresa.orgId } });
  await prisma.token.deleteMany({ where: { userId: { in: empresa.usuarios } } });
  await prisma.authAttempt.deleteMany({ where: { userId: { in: empresa.usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: empresa.usuarios } } });
  await prisma.establishment.deleteMany({ where: { organizationId: empresa.orgId } });
  await prisma.account.deleteMany({ where: { id: empresa.contaId } });
  await prisma.organization.deleteMany({ where: { id: empresa.orgId } });
});

describe("o painel de ativação no recorte do gestor [C3-5]", () => {
  it("o RH vê a empresa inteira, inclusive quem está sem unidade e sem ficha", async () => {
    const res = await painel(token.rh);
    expect(res.status).toBe(200);
    expect(quem(res.body)).toEqual(
      ["Rita", "Gil", "Ana", "Bia", "Caio", "Davi", "Gus"].map((n) => id[n]).sort(),
    );
    expect(res.body.can_act).toBe(true);
  });

  it("o gerente vê só a unidade que gere e a própria conta, e os totais só dela", async () => {
    const res = await painel(token.gil);
    expect(res.status).toBe(200);
    expect(quem(res.body), "Caio é da AG, Davi está sem unidade, Rita sem ficha").toEqual(
      ["Gil", "Ana", "Bia", "Gus"].map((n) => id[n]).sort(),
    );
    const unidades = (res.body.totals_by_unit as { id: string; counts: Record<string, number> }[])
      .map((t) => t.id)
      .sort();
    expect(unidades, "a AG aparece só pela própria conta do Gil").toEqual([ag, loja].sort());
    const daAg = (res.body.totals_by_unit as { id: string; counts: Record<string, number> }[]).find(
      (t) => t.id === ag,
    )!;
    expect(Object.values(daAg.counts).reduce((a, b) => a + b, 0)).toBe(1);
    expect(res.body.can_act).toBe(false);
  });

  it("o gerente sem unidade atribuída vê só a própria conta", async () => {
    const res = await painel(token.gus);
    expect(res.status).toBe(200);
    expect(quem(res.body)).toEqual([id.Gus]);
  });
});
