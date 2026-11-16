import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { AccountRole, AssessmentStatus, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O cartão do Início das avaliações a validar, separado por quem avaliou
 * (Correção 6, C6-13). Quem avaliou não valida: as suas esperam outra
 * pessoa, e as dos outros são para você validar.
 *
 * Empresa própria do teste: a Sara (SST) avaliou dois riscos (um em
 * rascunho, um em revisão); o Tito (SST) avaliou um, em revisão; uma
 * avaliação validada não conta. Apagada no fim.
 */
const SUFIXO = Date.now().toString(36);
const SENHA = ["cartao", "validacao"].join("-");
const as = (t: string) => ({ Authorization: `Bearer ${t}` });

let app: Express;
let orgId = "";
let contaId = "";
const id: Record<string, string> = {};
const token: Record<string, string> = {};

async function pessoa(nome: string, role: Role) {
  const login = `cv.${nome.toLowerCase()}.${SUFIXO}`;
  const user = await prisma.user.create({ data: { login, name: `${nome} ${SUFIXO}`, passwordHash: await bcrypt.hash(SENHA, 4) } });
  id[nome] = user.id;
  await prisma.membership.create({ data: { userId: user.id, organizationId: orgId, role } });
  await prisma.accountMembership.create({ data: { accountId: contaId, userId: user.id, role: AccountRole.USER } });
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  token[nome] = res.body.token;
}

const cartoes = async (quem: string) => {
  const res = await request(app).get("/api/inicio").set(as(token[quem]!));
  expect(res.status).toBe(200);
  return Object.fromEntries(
    (res.body.desk as { id: string; label: string; count: number }[])
      .filter((c) => c.id.startsWith("avaliacoes_"))
      .map((c) => [c.id, [c.label, c.count]]),
  );
};

beforeAll(async () => {
  app = createApp();
  orgId = (await prisma.organization.create({ data: { name: `CV ${SUFIXO}` } })).id;
  contaId = (await prisma.account.create({ data: { organizationId: orgId, name: `Conta CV ${SUFIXO}` } })).id;
  await pessoa("Sara", Role.SST);
  await pessoa("Tito", Role.SST);
  await pessoa("Mia", Role.MASTER);

  const filial = (await prisma.establishment.create({ data: { organizationId: orgId, name: `Loja ${SUFIXO}` } })).id;
  const setor = (await prisma.sector.create({ data: { organizationId: orgId, establishmentId: filial, name: "Frente" } })).id;
  const atividade = (
    await prisma.activity.create({ data: { organizationId: orgId, establishmentId: filial, sectorId: setor, name: "Repor" } })
  ).id;
  const perigo = (
    await prisma.hazard.create({ data: { organizationId: orgId, activityId: atividade, description: "Queda", createdById: id.Sara! } })
  ).id;
  const metodologia = await prisma.riskMethodology.create({ data: { organizationId: orgId, name: `Matriz ${SUFIXO}` } });
  const versao = (
    await prisma.riskMethodologyVersion.create({
      data: { methodologyId: metodologia.id, version: 1, severityScale: [], probabilityScale: [], matrix: [], levels: [] },
    })
  ).id;
  const avaliacao = async (assessorId: string, status: AssessmentStatus) => {
    const risco = (await prisma.risk.create({ data: { organizationId: orgId, hazardId: perigo, description: `Risco ${status}` } })).id;
    await prisma.riskAssessment.create({
      data: {
        organizationId: orgId,
        riskId: risco,
        methodologyVersionId: versao,
        severity: 2,
        probability: 2,
        resultingLevel: "MEDIUM",
        assessorId,
        status,
        ...(status === AssessmentStatus.VALIDATED ? { validatedById: id.Mia, validatedAt: new Date() } : {}),
      } as never,
    });
  };
  await avaliacao(id.Sara!, AssessmentStatus.DRAFT);
  await avaliacao(id.Sara!, AssessmentStatus.IN_REVIEW);
  await avaliacao(id.Tito!, AssessmentStatus.IN_REVIEW);
  await avaliacao(id.Tito!, AssessmentStatus.VALIDATED);
});

afterAll(async () => {
  if (!orgId) return;
  await prisma.riskAssessment.deleteMany({ where: { organizationId: orgId } });
  await prisma.risk.deleteMany({ where: { organizationId: orgId } });
  await prisma.hazard.deleteMany({ where: { organizationId: orgId } });
  await prisma.activity.deleteMany({ where: { organizationId: orgId } });
  await prisma.sector.deleteMany({ where: { organizationId: orgId } });
  await prisma.riskMethodology.deleteMany({ where: { organizationId: orgId } });
  await prisma.establishment.deleteMany({ where: { organizationId: orgId } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.accountMembership.deleteMany({ where: { accountId: contaId } });
  await prisma.membership.deleteMany({ where: { organizationId: orgId } });
  const usuarios = Object.values(id);
  await prisma.token.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.account.deleteMany({ where: { id: contaId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
});

describe("o cartão das avaliações a validar [C6-13]", () => {
  it("a Sara vê as dela esperando outra pessoa, e a do Tito para ela validar", async () => {
    expect(await cartoes("Sara")).toEqual({
      avaliacoes_suas: ["Avaliações suas esperando validação de outra pessoa", 2],
      avaliacoes_para_validar: ["Avaliações de risco para você validar", 1],
    });
  });

  it("o Tito vê a dele esperando outra pessoa, e as duas da Sara para ele validar", async () => {
    expect(await cartoes("Tito")).toEqual({
      avaliacoes_suas: ["Avaliações suas esperando validação de outra pessoa", 1],
      avaliacoes_para_validar: ["Avaliações de risco para você validar", 2],
    });
  });

  it("quem não avaliou nenhuma vê só o cartão de validar, sem o das suas com zero", async () => {
    expect(await cartoes("Mia")).toEqual({
      avaliacoes_para_validar: ["Avaliações de risco para você validar", 3],
    });
  });

  it("validada a do Tito, a Sara não tem nada para validar e vê só o cartão das dela", async () => {
    await prisma.riskAssessment.updateMany({
      where: { organizationId: orgId, assessorId: id.Tito, status: AssessmentStatus.IN_REVIEW },
      data: { status: AssessmentStatus.VALIDATED, validatedById: id.Mia, validatedAt: new Date() },
    });
    expect(await cartoes("Sara")).toEqual({
      avaliacoes_suas: ["Avaliações suas esperando validação de outra pessoa", 2],
    });
  });
});
