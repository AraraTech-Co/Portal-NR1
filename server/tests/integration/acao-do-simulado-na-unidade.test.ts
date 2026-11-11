import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * A ação aberta pelo achado do simulado guarda a unidade do simulado. [C3-6]
 *
 * Decisão 7 da devolutiva da C2 (10/11). Antes, a ação nascia sem unidade e
 * ficava só com a central, com quem a executa e com quem a abriu: o outro
 * gestor da mesma loja não a via. Agora ela é da unidade do procedimento do
 * simulado. A ação antiga, sem simulado, continua com a central.
 *
 * Empresa própria do teste: a Loja (gerentes Gil e Lia) e a AG (gerente Hugo).
 */
const SUFIXO = Date.now().toString(36);
const SENHA = ["c36", "simulado", "unidade"].join("-");
const AMANHA = new Date(Date.now() + 7 * 24 * 3600_000).toISOString().slice(0, 10);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
const empresa = { orgId: "", contaId: "", usuarios: [] as string[] };
const outra = { orgId: "" };
let loja = "";
let ag = "";
let simuladoDaLoja = "";
let simuladoDeOutraEmpresa = "";
const id: Record<string, string> = {};
const token: Record<string, string> = {};

async function pessoa(nome: string, role: Role, filial: string | null, gere: string[] = []) {
  const login = `c36.${nome.toLowerCase()}.${SUFIXO}`;
  const user = await prisma.user.create({
    data: { login, name: `${nome} C36`, passwordHash: await bcrypt.hash(SENHA, 4) },
  });
  empresa.usuarios.push(user.id);
  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId: empresa.orgId, role },
  });
  await prisma.accountMembership.create({
    data: { accountId: empresa.contaId, userId: user.id, role: AccountRole.USER },
  });
  if (filial) {
    await prisma.employeeProfile.create({
      data: { organizationId: empresa.orgId, userId: user.id, establishmentId: filial },
    });
  }
  for (const unidade of gere) {
    await prisma.managedEstablishment.create({
      data: {
        organizationId: empresa.orgId,
        membershipId: membership.id,
        establishmentId: unidade,
        createdById: user.id,
      },
    });
  }
  id[nome] = user.id;
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  token[nome] = res.body.token;
}

async function simulado(orgId: string, establishmentId: string, criadoPor: string) {
  const procedimento = await prisma.emergencyProcedure.create({
    data: {
      organizationId: orgId,
      establishmentId,
      scenario: `Incêndio ${SUFIXO}`,
      evacuationPlan: "Evacuar pela saída lateral.",
    },
  });
  const drill = await prisma.emergencyDrill.create({
    data: {
      procedureId: procedimento.id,
      performedAt: new Date(),
      findings: "A porta lateral estava trancada.",
      recordedById: criadoPor,
    },
  });
  return drill.id;
}

const abrir = (quem: string, extra: Record<string, unknown>) =>
  request(app)
    .post("/api/actions")
    .set(as(token[quem]))
    .send({
      title: "Destrancar a porta lateral",
      description: "Achado do simulado de emergência: a porta lateral estava trancada.",
      assignee_id: id.Ana,
      due_date: AMANHA,
      priority: "HIGH",
      effectiveness_criteria: "Porta aberta no próximo simulado.",
      ...extra,
    });

const lista = async (quem: string) =>
  ((await request(app).get("/api/actions").set(as(token[quem]))).body.actions as { id: string }[]).map(
    (a) => a.id,
  );

beforeAll(async () => {
  app = createApp();
  const org = await prisma.organization.create({ data: { name: `C36 ${SUFIXO}` } });
  empresa.orgId = org.id;
  empresa.contaId = (
    await prisma.account.create({ data: { organizationId: org.id, name: `Conta C36 ${SUFIXO}` } })
  ).id;
  loja = (await prisma.establishment.create({ data: { organizationId: org.id, name: `Loja ${SUFIXO}` } })).id;
  ag = (await prisma.establishment.create({ data: { organizationId: org.id, name: `AG ${SUFIXO}` } })).id;

  await pessoa("Sara", Role.SST, null);
  await pessoa("Gil", Role.GERENTE, loja, [loja]);
  await pessoa("Lia", Role.GERENTE, loja, [loja]);
  await pessoa("Hugo", Role.GERENTE, ag, [ag]);
  await pessoa("Ana", Role.COLABORADOR, loja);
  simuladoDaLoja = await simulado(empresa.orgId, loja, id.Gil);

  const alheia = await prisma.organization.create({ data: { name: `C36 Alheia ${SUFIXO}` } });
  outra.orgId = alheia.id;
  const dela = await prisma.establishment.create({ data: { organizationId: alheia.id, name: `Alheia ${SUFIXO}` } });
  simuladoDeOutraEmpresa = await simulado(alheia.id, dela.id, id.Sara);
});

afterAll(async () => {
  for (const orgId of [empresa.orgId, outra.orgId]) {
    if (!orgId) continue;
    await prisma.notification.deleteMany({ where: { organizationId: orgId } });
    await prisma.auditEvent.deleteMany({ where: { organizationId: orgId } });
    await prisma.action.deleteMany({ where: { organizationId: orgId } });
    await prisma.emergencyDrill.deleteMany({ where: { procedure: { organizationId: orgId } } });
    await prisma.emergencyProcedure.deleteMany({ where: { organizationId: orgId } });
    await prisma.employeeProfile.deleteMany({ where: { organizationId: orgId } });
    await prisma.managedEstablishment.deleteMany({ where: { organizationId: orgId } });
    await prisma.membership.deleteMany({ where: { organizationId: orgId } });
    await prisma.establishment.deleteMany({ where: { organizationId: orgId } });
  }
  await prisma.accountMembership.deleteMany({ where: { accountId: empresa.contaId } });
  await prisma.token.deleteMany({ where: { userId: { in: empresa.usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: empresa.usuarios } } });
  await prisma.account.deleteMany({ where: { id: empresa.contaId } });
  for (const orgId of [empresa.orgId, outra.orgId]) {
    if (orgId) await prisma.organization.deleteMany({ where: { id: orgId } });
  }
});

describe("a ação do simulado é da unidade do simulado [C3-6]", () => {
  it("o gerente da Loja abre pelo achado: a ação guarda a Loja e o simulado", async () => {
    const res = await abrir("Gil", { drill_id: simuladoDaLoja });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const gravada = await prisma.action.findUniqueOrThrow({
      where: { id: res.body.action.id },
      select: { establishmentId: true, drillId: true },
    });
    expect(gravada).toEqual({ establishmentId: loja, drillId: simuladoDaLoja });
  });

  it("o outro gerente da Loja vê a ação; o gerente da AG não", async () => {
    const res = await abrir("Gil", { drill_id: simuladoDaLoja });
    const acao = res.body.action.id as string;
    expect(await lista("Lia"), "é da Loja, que a Lia gere").toContain(acao);
    expect(await lista("Hugo")).not.toContain(acao);
    expect(await lista("Sara"), "a central vê tudo").toContain(acao);

    /* A lista diz a unidade e a filtra, como faz com a ação do risco. */
    const daLoja = (
      await request(app).get(`/api/actions?establishment_id=${loja}`).set(as(token.Sara))
    ).body.actions as { id: string; establishment: { id: string } | null }[];
    expect(daLoja.find((a) => a.id === acao)?.establishment?.id).toBe(loja);
    const daAg = (
      await request(app).get(`/api/actions?establishment_id=${ag}`).set(as(token.Sara))
    ).body.actions as { id: string }[];
    expect(daAg.map((a) => a.id)).not.toContain(acao);
  });

  it("o outro gerente da Loja age na ação: completa o critério; o da AG nem a encontra", async () => {
    const acao = (await abrir("Gil", { drill_id: simuladoDaLoja })).body.action.id as string;
    const criterio = (quem: string) =>
      request(app)
        .patch(`/api/actions/${acao}/criterio`)
        .set(as(token[quem]))
        .send({ effectiveness_criteria: "Porta aberta em dois simulados seguidos." });
    const daLia = await criterio("Lia");
    expect(daLia.status, JSON.stringify(daLia.body)).toBe(200);
    expect((await criterio("Hugo")).status).toBe(404);

    const semSimulado = (await abrir("Gil", {})).body.action.id as string;
    const naSemUnidade = await request(app)
      .patch(`/api/actions/${semSimulado}/criterio`)
      .set(as(token.Lia))
      .send({ effectiveness_criteria: "Qualquer." });
    expect(naSemUnidade.status, "a ação sem unidade continua com a central").toBe(404);
  });

  it("o gerente da AG não abre ação pelo simulado da Loja", async () => {
    const res = await abrir("Hugo", { drill_id: simuladoDaLoja, assignee_id: id.Hugo });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Simulado inválido.");
  });

  it("simulado de outra empresa ou que não existe é recusado", async () => {
    for (const drill_id of [simuladoDeOutraEmpresa, "00000000-0000-4000-8000-000000000000"]) {
      const res = await abrir("Sara", { drill_id });
      expect(res.status, drill_id).toBe(400);
      expect(res.body.message).toBe("Simulado inválido.");
    }
  });

  it("a central abre pelo simulado e a ação também fica com a Loja", async () => {
    const res = await abrir("Sara", { drill_id: simuladoDaLoja });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await lista("Lia")).toContain(res.body.action.id);
  });

  it("a ação sem simulado continua sem unidade, com a central", async () => {
    const res = await abrir("Gil", {});
    expect(res.status).toBe(201);
    const acao = res.body.action.id as string;
    expect(
      (await prisma.action.findUniqueOrThrow({ where: { id: acao }, select: { establishmentId: true } }))
        .establishmentId,
    ).toBeNull();
    expect(await lista("Lia"), "sem unidade, a Lia não vê a do Gil").not.toContain(acao);
    expect(await lista("Gil"), "quem abriu continua vendo").toContain(acao);
  });
});
