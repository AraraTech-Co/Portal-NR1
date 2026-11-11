import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O plano de ação do PGR e o painel da fiscalização, por unidade, seguem a
 * unidade da ação. [C3-6]
 *
 * Decisão do Orquestrador em 10/11, depois da C3-6:
 * - o PGR "plano de ação" de uma unidade leva as ações daquela unidade, pela
 *   mesma regra do recorte (`actionInUnits`): a do risco e, sem risco, a do
 *   simulado. Só as versões novas mudam;
 * - o painel filtrado por unidade leva as ações daquela unidade e as ações
 *   sem unidade nenhuma, e deixa de levar a do simulado de OUTRA unidade.
 *
 * Empresa própria do teste: a Loja e a AG.
 */
const SUFIXO = Date.now().toString(36);
const SENHA = ["c36b", "plano", "painel"].join("-");

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
const empresa = { orgId: "", contaId: "", usuarios: [] as string[] };
let loja = "";
let ag = "";
let sst = "";
let sstId = "";
const titulo = {
  simuladoLoja: `Destrancar a porta da Loja ${SUFIXO}`,
  simuladoAg: `Trocar o extintor da AG ${SUFIXO}`,
  semUnidade: `Revisar o regulamento ${SUFIXO}`,
  riscoLoja: `Calçado de segurança na Loja ${SUFIXO}`,
  mudancaAg: `Treinar na esteira nova da AG ${SUFIXO}`,
  ocorrenciaLoja: `Sinalizar o piso molhado da Loja ${SUFIXO}`,
  ocorrenciaAg: `Consertar a prateleira da AG ${SUFIXO}`,
};

async function simulado(establishmentId: string) {
  const procedimento = await prisma.emergencyProcedure.create({
    data: { organizationId: empresa.orgId, establishmentId, scenario: `Incêndio ${SUFIXO}` },
  });
  return (
    await prisma.emergencyDrill.create({
      data: { procedureId: procedimento.id, performedAt: new Date(), findings: "Achado", recordedById: sstId },
    })
  ).id;
}

async function riscoNa(establishmentId: string) {
  const setor = await prisma.sector.create({
    data: { organizationId: empresa.orgId, establishmentId, name: `Setor ${SUFIXO}` },
  });
  const atividade = await prisma.activity.create({
    data: { organizationId: empresa.orgId, establishmentId, sectorId: setor.id, name: "Repor" },
  });
  const perigo = await prisma.hazard.create({
    data: { organizationId: empresa.orgId, activityId: atividade.id, description: "Queda", createdById: sstId },
  });
  return (
    await prisma.risk.create({ data: { organizationId: empresa.orgId, hazardId: perigo.id, description: "Pé" } })
  ).id;
}

const acao = (title: string, extra: Record<string, unknown>) =>
  prisma.action.create({
    data: {
      organizationId: empresa.orgId,
      title,
      assigneeId: sstId,
      createdById: sstId,
      dueDate: new Date(Date.now() + 7 * 24 * 3600_000),
      effectivenessCriteria: "Conferido no próximo simulado.",
      ...extra,
    },
  });

beforeAll(async () => {
  app = createApp();
  const org = await prisma.organization.create({ data: { name: `C36b ${SUFIXO}` } });
  empresa.orgId = org.id;
  empresa.contaId = (
    await prisma.account.create({ data: { organizationId: org.id, name: `Conta C36b ${SUFIXO}` } })
  ).id;
  loja = (await prisma.establishment.create({ data: { organizationId: org.id, name: `Loja ${SUFIXO}` } })).id;
  ag = (await prisma.establishment.create({ data: { organizationId: org.id, name: `AG ${SUFIXO}` } })).id;

  const login = `c36b.sara.${SUFIXO}`;
  const user = await prisma.user.create({
    data: { login, name: "Sara C36b", passwordHash: await bcrypt.hash(SENHA, 4) },
  });
  sstId = user.id;
  empresa.usuarios.push(user.id);
  await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role: Role.SST } });
  await prisma.accountMembership.create({
    data: { accountId: empresa.contaId, userId: user.id, role: AccountRole.USER },
  });
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login: ${JSON.stringify(res.body)}`).toBe(200);
  sst = res.body.token;
  await prisma.organization.update({ where: { id: org.id }, data: { responsibleName: "Sara C36b" } });

  await acao(titulo.simuladoLoja, { drillId: await simulado(loja), establishmentId: loja });
  await acao(titulo.simuladoAg, { drillId: await simulado(ag), establishmentId: ag });
  await acao(titulo.semUnidade, {});
  await acao(titulo.riscoLoja, { riskId: await riscoNa(loja), sourceType: "RISK" });
  /* Ação de mudança da AG: tem unidade, então não é "sem unidade" na Loja. */
  const mudanca = await prisma.changeEvent.create({
    data: {
      organizationId: empresa.orgId,
      establishmentId: ag,
      type: "NEW_EQUIPMENT",
      description: "Esteira nova",
      reportedById: sstId,
    },
  });
  await acao(titulo.mudancaAg, { changeEventId: mudanca.id, sourceType: "CHANGE_EVENT" });
  /* Ações de ocorrência: a da Loja é da Loja; a da AG não é "sem unidade". */
  for (const [nome, unidade] of [
    [titulo.ocorrenciaLoja, loja],
    [titulo.ocorrenciaAg, ag],
  ] as const) {
    const ocorrencia = await prisma.occurrence.create({
      data: {
        organizationId: empresa.orgId,
        establishmentId: unidade,
        type: "DANGEROUS_EVENT",
        occurredAt: new Date(),
        description: `Ocorrência ${nome}`,
        reportedById: sstId,
      },
    });
    await acao(nome, { occurrenceId: ocorrencia.id, sourceType: "OCCURRENCE" });
  }
});

afterAll(async () => {
  const orgId = empresa.orgId;
  if (!orgId) return;
  await prisma.auditEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.pgrDocument.deleteMany({ where: { organizationId: orgId } });
  await prisma.action.deleteMany({ where: { organizationId: orgId } });
  await prisma.changeEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.occurrence.deleteMany({ where: { organizationId: orgId } });
  await prisma.risk.deleteMany({ where: { organizationId: orgId } });
  await prisma.hazard.deleteMany({ where: { organizationId: orgId } });
  await prisma.activity.deleteMany({ where: { organizationId: orgId } });
  await prisma.sector.deleteMany({ where: { organizationId: orgId } });
  await prisma.emergencyDrill.deleteMany({ where: { procedure: { organizationId: orgId } } });
  await prisma.emergencyProcedure.deleteMany({ where: { organizationId: orgId } });
  await prisma.accountMembership.deleteMany({ where: { accountId: empresa.contaId } });
  await prisma.membership.deleteMany({ where: { organizationId: orgId } });
  await prisma.token.deleteMany({ where: { userId: { in: empresa.usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: empresa.usuarios } } });
  await prisma.establishment.deleteMany({ where: { organizationId: orgId } });
  await prisma.account.deleteMany({ where: { id: empresa.contaId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
});

const planoDoPgr = async (establishment_id: string | null) => {
  const res = await request(app)
    .post("/api/pgr-documents")
    .set(as(sst))
    .send({ type: "ACTION_PLAN", establishment_id, responsible_name: "Sara C36b" });
  expect(res.status, `emitir o plano: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(201);
  return (res.body.document.content.actions as { title: string }[]).map((a) => a.title).sort();
};

const doPainel = async (establishmentId: string | null) => {
  const res = await request(app)
    .get(`/api/fiscalizacao${establishmentId ? `?establishment_id=${establishmentId}` : ""}`)
    .set(as(sst));
  expect(res.status, `painel: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(200);
  const plano = (res.body.checks as { id: string; items: { label: string }[] }[]).find(
    (c) => c.id === "plano_acao",
  )!;
  return plano.items.map((i) => i.label).sort();
};

describe("o PGR plano de ação por unidade leva as ações da unidade [C3-6]", () => {
  it("o da Loja leva a do risco e a do simulado da Loja; não a da AG nem a sem unidade", async () => {
    expect(await planoDoPgr(loja)).toEqual(
      [titulo.riscoLoja, titulo.simuladoLoja, titulo.ocorrenciaLoja].sort(),
    );
  });

  it("o da AG leva a do simulado, a da mudança e a da ocorrência da AG", async () => {
    expect(await planoDoPgr(ag)).toEqual([titulo.mudancaAg, titulo.simuladoAg, titulo.ocorrenciaAg].sort());
  });

  it("o da organização continua com todas", async () => {
    expect(await planoDoPgr(null)).toEqual(Object.values(titulo).sort());
  });
});

describe("o painel filtrado por unidade [C3-6]", () => {
  it("na Loja: as da Loja e a sem unidade; a do simulado da AG sai", async () => {
    expect(await doPainel(loja)).toEqual(
      [titulo.riscoLoja, titulo.simuladoLoja, titulo.ocorrenciaLoja, titulo.semUnidade].sort(),
    );
  });

  it("sem filtro, todas", async () => {
    expect(await doPainel(null)).toEqual(Object.values(titulo).sort());
  });
});
