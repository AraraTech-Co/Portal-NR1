import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { AccountRole, RequirementKind, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Copiar de outra filial sem duplicar o que o destino já tem com nome
 * equivalente (Correção 6, C6-6 e D6-8).
 *
 * Empresa própria do teste:
 * - a Origem tem o setor "Frente", com Repositor (exige os treinamentos X e
 *   Y), Repositora (exige Y), Caixa (exige o certificado "ASO em dia" e o
 *   exame "ASO em dia", sem treinamento), Operador e Embalador (exige Y);
 *   a atividade "Repor gôndola", ligada ao Repositor e ao Operador, com um
 *   perigo e um risco; o setor "Depósito", com Estoquista e "Conferir carga";
 *   e o setor "Padaria", vazio;
 * - o Destino foi feito pela planilha: o setor "FRENTE", com Repositor
 *   (exige X, com outra validade e descrição) e Caixa (exige o certificado
 *   "ASO EM DIA"); e, à mão, Operador e Operadora, os setores "Deposito" e
 *   "DEPÓSITO", e arquivados o setor "Padaria" e a função Embalador.
 *
 * Apagada no fim.
 */
const SUFIXO = Date.now().toString(36);
const SENHA = ["copia", "sem", "duplicar"].join("-");
const as = (t: string) => ({ Authorization: `Bearer ${t}` });

let app: Express;
let orgId = "";
let contaId = "";
let usuario = "";
let mia = "";
let origem = "";
let destino = "";
const o: Record<string, string> = {};
const d: Record<string, string> = {};

const previa = () =>
  request(app).post(`/api/establishments/${destino}/copia/previa`).set(as(mia)).send({ origem });
const copiar = () =>
  request(app).post(`/api/establishments/${destino}/copia`).set(as(mia)).send({ origem });

async function noDestino() {
  return {
    setores: await prisma.sector.findMany({ where: { establishmentId: destino, archivedAt: null }, orderBy: { name: "asc" } }),
    funcoes: await prisma.jobRole.findMany({
      where: { sector: { establishmentId: destino }, archivedAt: null },
      include: { requirements: { orderBy: { name: "asc" } }, activities: { include: { activity: true } } },
      orderBy: { name: "asc" },
    }),
    atividades: await prisma.activity.findMany({ where: { establishmentId: destino } }),
    perigos: await prisma.hazard.findMany({ where: { activity: { establishmentId: destino } } }),
    riscos: await prisma.risk.findMany({ where: { hazard: { activity: { establishmentId: destino } } } }),
    exigencias: await prisma.jobRoleRequirement.count({ where: { jobRole: { sector: { establishmentId: destino } } } }),
  };
}

beforeAll(async () => {
  app = createApp();
  orgId = (await prisma.organization.create({ data: { name: `CSD ${SUFIXO}` } })).id;
  contaId = (await prisma.account.create({ data: { organizationId: orgId, name: `Conta CSD ${SUFIXO}` } })).id;
  origem = (await prisma.establishment.create({ data: { organizationId: orgId, name: `Origem ${SUFIXO}` } })).id;
  destino = (await prisma.establishment.create({ data: { organizationId: orgId, name: `Destino ${SUFIXO}` } })).id;

  const login = `csd.mia.${SUFIXO}`;
  const user = await prisma.user.create({ data: { login, name: `Mia ${SUFIXO}`, passwordHash: await bcrypt.hash(SENHA, 4) } });
  usuario = user.id;
  await prisma.membership.create({ data: { userId: user.id, organizationId: orgId, role: Role.MASTER } });
  await prisma.accountMembership.create({ data: { accountId: contaId, userId: user.id, role: AccountRole.USER } });

  const treinamento = async (title: string) =>
    (await prisma.training.create({ data: { organizationId: orgId, title: `${title} ${SUFIXO}`, createdById: user.id } })).id;
  o.tX = await treinamento("X");
  o.tY = await treinamento("Y");

  const setor = (establishmentId: string, name: string) =>
    prisma.sector.create({ data: { organizationId: orgId, establishmentId, name } }).then((s) => s.id);
  const funcao = (sectorId: string, name: string, cbo2002: string | null = null) =>
    prisma.jobRole.create({ data: { organizationId: orgId, sectorId, name, cbo2002 } }).then((f) => f.id);
  const exige = (jobRoleId: string, data: { name: string; trainingId?: string; kind?: RequirementKind; validityMonths?: number; description?: string }) =>
    prisma.jobRoleRequirement.create({ data: { organizationId: orgId, jobRoleId, ...data } }).then((e) => e.id);

  /* A origem. */
  o.frente = await setor(origem, "Frente");
  o.repositor = await funcao(o.frente, "Repositor", "5211-25");
  o.exigeX = await exige(o.repositor, { name: "Treinamento X", trainingId: o.tX, kind: RequirementKind.TRAINING, validityMonths: 12 });
  o.exigeY = await exige(o.repositor, { name: "Treinamento Y", trainingId: o.tY, kind: RequirementKind.TRAINING, validityMonths: 12 });
  o.repositora = await funcao(o.frente, "Repositora");
  await exige(o.repositora, { name: "Treinamento Y", trainingId: o.tY, kind: RequirementKind.TRAINING });
  o.caixa = await funcao(o.frente, "Caixa");
  await exige(o.caixa, { name: "ASO em dia", kind: RequirementKind.CERTIFICATE });
  o.exameAso = await exige(o.caixa, { name: "ASO em dia", kind: RequirementKind.EXAM });
  o.operador = await funcao(o.frente, "Operador");
  await exige(o.operador, { name: "Treinamento Y", trainingId: o.tY, kind: RequirementKind.TRAINING });
  o.embalador = await funcao(o.frente, "Embalador");
  await exige(o.embalador, { name: "Treinamento Y", trainingId: o.tY, kind: RequirementKind.TRAINING });
  o.repor = (await prisma.activity.create({ data: { organizationId: orgId, establishmentId: origem, sectorId: o.frente, name: "Repor gôndola" } })).id;
  await prisma.activityJobRole.createMany({
    data: [
      { activityId: o.repor, jobRoleId: o.repositor },
      { activityId: o.repor, jobRoleId: o.operador },
    ],
  });
  o.perigo = (await prisma.hazard.create({ data: { organizationId: orgId, activityId: o.repor, description: "Queda de caixa", createdById: user.id } })).id;
  o.risco = (await prisma.risk.create({ data: { organizationId: orgId, hazardId: o.perigo, description: "Lesão no pé" } })).id;
  o.deposito = await setor(origem, "Depósito");
  o.estoquista = await funcao(o.deposito, "Estoquista");
  await prisma.activity.create({ data: { organizationId: orgId, establishmentId: origem, sectorId: o.deposito, name: "Conferir carga" } });
  await setor(origem, "Padaria");

  /* O destino, feito pela planilha e à mão. */
  d.frente = await setor(destino, "FRENTE");
  d.repositor = await funcao(d.frente, "Repositor", "5211-30");
  d.exigeX = await exige(d.repositor, {
    name: "Treinamento X da filial",
    trainingId: o.tX,
    kind: RequirementKind.TRAINING,
    validityMonths: 24,
    description: "Como a filial pede",
  });
  d.caixa = await funcao(d.frente, "Caixa");
  await exige(d.caixa, { name: "ASO EM DIA", kind: RequirementKind.CERTIFICATE });
  d.operador = await funcao(d.frente, "Operador");
  d.operadora = await funcao(d.frente, "Operadora");
  await setor(destino, "Deposito");
  await setor(destino, "DEPÓSITO");
  await prisma.sector.update({ where: { id: await setor(destino, "Padaria") }, data: { archivedAt: new Date() } });
  await prisma.jobRole.update({ where: { id: await funcao(d.frente, "Embalador") }, data: { archivedAt: new Date() } });

  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  mia = res.body.token;
});

afterAll(async () => {
  if (!orgId) return;
  await prisma.notification.deleteMany({ where: { organizationId: orgId } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.establishmentCopy.deleteMany({ where: { organizationId: orgId } });
  await prisma.riskAssessment.deleteMany({ where: { organizationId: orgId } });
  await prisma.controlMeasure.deleteMany({ where: { organizationId: orgId } });
  await prisma.risk.deleteMany({ where: { organizationId: orgId } });
  await prisma.hazard.deleteMany({ where: { organizationId: orgId } });
  await prisma.activity.deleteMany({ where: { organizationId: orgId } });
  await prisma.jobRoleRequirement.deleteMany({ where: { organizationId: orgId } });
  await prisma.jobRole.deleteMany({ where: { organizationId: orgId } });
  await prisma.sector.deleteMany({ where: { organizationId: orgId } });
  await prisma.training.deleteMany({ where: { organizationId: orgId } });
  await prisma.accountMembership.deleteMany({ where: { accountId: contaId } });
  await prisma.membership.deleteMany({ where: { organizationId: orgId } });
  await prisma.token.deleteMany({ where: { userId: usuario } });
  await prisma.user.deleteMany({ where: { id: usuario } });
  await prisma.establishment.deleteMany({ where: { organizationId: orgId } });
  await prisma.account.deleteMany({ where: { id: contaId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
});

const DE_FORA = [
  'Há dois setores equivalentes a "Depósito" nesta filial (Deposito e DEPÓSITO). Arquive um em Operação e copie de novo.',
  'Há duas funções equivalentes a "Operador" nesta filial (Operador e Operadora). Arquive uma em Operação e copie de novo.',
];

describe("copiar para a filial que já tem as funções da planilha [C6-6]", () => {
  it("a prévia diz o que já existia, o que fica de fora e a exigência que falta, e não cria setor nem função", async () => {
    const res = await previa();
    expect(res.status).toBe(200);
    expect(res.body.ja_existia).toEqual({ setores: 1, funcoes: 2 });
    /* Y no Repositor e o exame no Caixa; o Y do Embalador vai numa função nova. */
    expect(res.body.exigencias_acrescentadas).toBe(2);
    expect([...res.body.de_fora].sort()).toEqual(DE_FORA);
    expect(res.body.niveis.setores.criar).toBe(1);
    expect(res.body.niveis.funcoes.criar).toBe(1);
    expect(res.body.niveis.atividades.criar).toBe(1);
    expect(res.body.niveis.exigencias.criar).toBe(3);
    /* O X e o certificado que o destino tinha, e o Y da Repositora, que cai no mesmo Repositor. */
    expect(res.body.niveis.exigencias.iguais).toBe(3);
  });

  it("copiar deixa um Repositor só, com o nome e o CBO do destino, e as atividades e riscos da origem ligados a ele", async () => {
    const res = await copiar();
    expect(res.status).toBe(200);
    expect(res.body.ja_existia).toEqual({ setores: 1, funcoes: 2 });
    expect(res.body.exigencias_acrescentadas).toBe(2);
    expect([...res.body.de_fora].sort()).toEqual(DE_FORA);

    /* O setor e a função arquivados no destino não contam: Padaria e Embalador vêm novos. */
    const depois = await noDestino();
    expect(depois.setores.map((s) => s.name)).toEqual(["DEPÓSITO", "Deposito", "FRENTE", "Padaria"]);
    expect(depois.funcoes.map((f) => f.name)).toEqual(["Caixa", "Embalador", "Operador", "Operadora", "Repositor"]);
    expect(depois.funcoes.find((f) => f.name === "Embalador")!.copiedFromId).toBe(o.embalador);
    const repositor = depois.funcoes.find((f) => f.name === "Repositor")!;
    expect(repositor.id).toBe(d.repositor);
    expect(repositor.cbo2002).toBe("5211-30");
    expect(repositor.copiedFromId).toBeNull();

    expect(depois.atividades.map((a) => [a.name, a.sectorId])).toEqual([["Repor gôndola", d.frente]]);
    expect(repositor.activities.map((v) => v.activity.name)).toEqual(["Repor gôndola"]);
    expect(depois.perigos.map((p) => [p.description, p.activityId])).toEqual([["Queda de caixa", depois.atividades[0]!.id]]);
    expect(depois.riscos.map((r) => [r.description, r.hazardId])).toEqual([["Lesão no pé", depois.perigos[0]!.id]]);
  });

  it("o Repositor tinha X e ganha só Y; o X dele fica como estava", async () => {
    const repositor = (await noDestino()).funcoes.find((f) => f.id === d.repositor)!;
    expect(repositor.requirements.map((e) => [e.trainingId, e.copiedFromId])).toEqual([
      [o.tX, null],
      [o.tY, o.exigeY],
    ]);
    const x = repositor.requirements.find((e) => e.id === d.exigeX)!;
    expect([x.name, x.validityMonths, x.description]).toEqual(["Treinamento X da filial", 24, "Como a filial pede"]);
  });

  it("a exigência sem treinamento compara pelo tipo e pelo nome: o Caixa não ganha outro certificado, mas ganha o exame", async () => {
    const caixa = (await noDestino()).funcoes.find((f) => f.id === d.caixa)!;
    expect(caixa.requirements.map((e) => [e.name, e.kind, e.copiedFromId])).toEqual([
      ["ASO EM DIA", RequirementKind.CERTIFICATE, null],
      ["ASO em dia", RequirementKind.EXAM, o.exameAso],
    ]);
  });

  it("com duas equivalentes no destino, nada da função nem do setor de fora entra", async () => {
    const depois = await noDestino();
    for (const id of [d.operador, d.operadora]) {
      const f = depois.funcoes.find((x) => x.id === id)!;
      expect(f.requirements).toEqual([]);
      expect(f.activities).toEqual([]);
    }
    expect(depois.funcoes.some((f) => f.name === "Estoquista")).toBe(false);
    expect(depois.atividades.some((a) => a.name === "Conferir carga")).toBe(false);
  });

  it("copiar de novo não duplica nada", async () => {
    const antes = await noDestino();
    const res = await copiar();
    expect(res.status).toBe(200);
    expect(res.body.exigencias_acrescentadas).toBe(0);
    const depois = await noDestino();
    expect(depois.setores.length).toBe(antes.setores.length);
    expect(depois.funcoes.length).toBe(antes.funcoes.length);
    expect(depois.atividades.length).toBe(antes.atividades.length);
    expect(depois.perigos.length).toBe(antes.perigos.length);
    expect(depois.riscos.length).toBe(antes.riscos.length);
    expect(depois.exigencias).toBe(antes.exigencias);
  });
});
