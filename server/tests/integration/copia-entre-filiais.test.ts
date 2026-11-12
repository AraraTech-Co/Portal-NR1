import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { AccountRole, AssessmentStatus, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Cópia entre filiais. [C3-8]
 *
 * Cópia, não espelho: leva setores, funções, atividades (com o vínculo à
 * função), perigos, riscos, medidas, a avaliação vigente e as exigências da
 * função. Tudo no destino aponta para o destino. Copiar de novo cria o que
 * falta, atualiza o que o destino não mexeu e pergunta antes de sobrescrever
 * o que o destino mexeu.
 *
 * Empresa própria: a Loja Centro (origem), a Loja Nova (destino), a Loja
 * Dois (destino da corrida), a Loja Grande (volume) e uma arquivada.
 */
const SUFIXO = Date.now().toString(36);
const SENHA = ["c38", "copia", "filiais"].join("-");

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
const empresa = { orgId: "", contaId: "", usuarios: [] as string[] };
const outra = { orgId: "", filial: "" };
const f = { centro: "", nova: "", dois: "", grande: "", velha: "" };
const id: Record<string, string> = {};
const token: Record<string, string> = {};
/** Os itens da origem. */
const o: Record<string, string> = {};
let versao = "";

async function pessoa(nome: string, role: Role) {
  const login = `c38.${nome.toLowerCase()}.${SUFIXO}`;
  const user = await prisma.user.create({
    data: { login, name: `${nome} C38`, passwordHash: await bcrypt.hash(SENHA, 4) },
  });
  empresa.usuarios.push(user.id);
  await prisma.membership.create({ data: { userId: user.id, organizationId: empresa.orgId, role } });
  await prisma.accountMembership.create({
    data: { accountId: empresa.contaId, userId: user.id, role: AccountRole.USER },
  });
  id[nome] = user.id;
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${nome}`).toBe(200);
  token[nome] = res.body.token;
}

const previa = (t: string, destino: string, origem: unknown) =>
  request(app).post(`/api/establishments/${destino}/copia/previa`).set(as(t)).send({ origem });
const copiar = (t: string, destino: string, origem: unknown, aceitar?: string[]) =>
  request(app)
    .post(`/api/establishments/${destino}/copia`)
    .set(as(t))
    .send({ origem, ...(aceitar ? { aceitar } : {}) });

const orgDe = () => empresa.orgId;

/** Tudo o que existe numa filial, com os pais, para conferir o remapeamento. */
async function arvore(filial: string) {
  const setores = await prisma.sector.findMany({ where: { establishmentId: filial } });
  const funcoes = await prisma.jobRole.findMany({
    where: { sector: { establishmentId: filial } },
    include: { sector: true, requirements: true },
  });
  const atividades = await prisma.activity.findMany({
    where: { sector: { establishmentId: filial } },
    include: { sector: true, jobRoles: { include: { jobRole: { include: { sector: true } } } } },
  });
  const perigos = await prisma.hazard.findMany({
    where: { activity: { establishmentId: filial } },
    include: { activity: true },
  });
  const riscos = await prisma.risk.findMany({
    where: { hazard: { activity: { establishmentId: filial } } },
    include: { hazard: { include: { activity: true } } },
  });
  const medidas = await prisma.controlMeasure.findMany({
    where: { risk: { hazard: { activity: { establishmentId: filial } } } },
    include: { risk: { include: { hazard: { include: { activity: true } } } } },
  });
  const avaliacoes = await prisma.riskAssessment.findMany({
    where: { risk: { hazard: { activity: { establishmentId: filial } } } },
    include: { risk: { include: { hazard: { include: { activity: true } } } } },
  });
  return { setores, funcoes, atividades, perigos, riscos, medidas, avaliacoes };
}

beforeAll(async () => {
  app = createApp();
  const org = await prisma.organization.create({ data: { name: `C38 ${SUFIXO}` } });
  empresa.orgId = org.id;
  empresa.contaId = (
    await prisma.account.create({ data: { organizationId: org.id, name: `Conta C38 ${SUFIXO}` } })
  ).id;
  const filial = async (name: string, archivedAt: Date | null = null) =>
    (await prisma.establishment.create({ data: { organizationId: org.id, name: `${name} ${SUFIXO}`, archivedAt } })).id;
  f.centro = await filial("Loja Centro");
  f.nova = await filial("Loja Nova");
  f.dois = await filial("Loja Dois");
  f.grande = await filial("Loja Grande");
  f.velha = await filial("Loja Velha", new Date());

  await pessoa("Sara", Role.SST);
  await pessoa("Tito", Role.SST);
  await pessoa("Mia", Role.MASTER);
  await pessoa("Otto", Role.OWNER);
  await pessoa("Rita", Role.RH);
  await pessoa("Gil", Role.GERENTE);

  const metodologia = await prisma.riskMethodology.create({
    data: { organizationId: org.id, name: `Matriz ${SUFIXO}` },
  });
  versao = (
    await prisma.riskMethodologyVersion.create({
      data: { methodologyId: metodologia.id, version: 1, severityScale: [], probabilityScale: [], matrix: [], levels: [] },
    })
  ).id;
  const treinamento = await prisma.training.create({
    data: { organizationId: org.id, title: `NR-35 ${SUFIXO}`, createdById: id.Sara },
  });
  o.treinamento = treinamento.id;

  /* A origem: um setor ativo e um arquivado. */
  o.setor = (
    await prisma.sector.create({
      data: { organizationId: org.id, establishmentId: f.centro, name: "Vendas", description: "Salão", processDescription: "Atender" },
    })
  ).id;
  o.setorArquivado = (
    await prisma.sector.create({
      data: { organizationId: org.id, establishmentId: f.centro, name: "Antigo", archivedAt: new Date() },
    })
  ).id;
  o.funcao = (
    await prisma.jobRole.create({ data: { organizationId: org.id, sectorId: o.setor, name: "Vendedor", position: 1 } })
  ).id;
  o.funcaoArquivada = (
    await prisma.jobRole.create({
      data: { organizationId: org.id, sectorId: o.setor, name: "Caixa antigo", archivedAt: new Date() },
    })
  ).id;
  o.exigencia = (
    await prisma.jobRoleRequirement.create({
      data: { organizationId: org.id, jobRoleId: o.funcao, kind: "TRAINING", name: "Altura", trainingId: o.treinamento, validityMonths: 24 },
    })
  ).id;
  o.atividade = (
    await prisma.activity.create({
      data: { organizationId: org.id, establishmentId: f.centro, sectorId: o.setor, name: "Repor gôndola" },
    })
  ).id;
  await prisma.activityJobRole.createMany({
    data: [
      { activityId: o.atividade, jobRoleId: o.funcao },
      { activityId: o.atividade, jobRoleId: o.funcaoArquivada },
    ],
  });
  o.perigo = (
    await prisma.hazard.create({
      data: {
        organizationId: org.id,
        activityId: o.atividade,
        description: "Queda de altura",
        source: "Escada",
        exposedWorkersCount: 4,
        category: "ACCIDENT",
        status: "CONFIRMED",
        createdById: id.Tito,
      },
    })
  ).id;
  o.perigoArquivado = (
    await prisma.hazard.create({
      data: { organizationId: org.id, activityId: o.atividade, description: "Velho", createdById: id.Tito, archivedAt: new Date() },
    })
  ).id;
  o.risco = (
    await prisma.risk.create({
      data: { organizationId: org.id, hazardId: o.perigo, description: "Fratura", needsReassessment: true, reassessmentReason: "Mudou a escada" },
    })
  ).id;
  o.riscoRascunho = (
    await prisma.risk.create({ data: { organizationId: org.id, hazardId: o.perigo, description: "Entorse" } })
  ).id;
  o.medida = (
    await prisma.controlMeasure.create({
      data: {
        organizationId: org.id,
        riskId: o.risco,
        type: "PPE",
        description: "Cinto",
        status: "IMPLEMENTED",
        implementedAt: new Date(),
        effectivenessStatus: "EFFECTIVE",
      },
    })
  ).id;
  const avaliacao = (riskId: string, extra: Record<string, unknown>) =>
    prisma.riskAssessment.create({
      data: {
        organizationId: org.id,
        riskId,
        methodologyVersionId: versao,
        severity: 3,
        probability: 2,
        resultingLevel: "MEDIUM",
        assessorId: id.Tito,
        ...extra,
      } as never,
    });
  const nova = await avaliacao(o.risco, {
    severity: 4,
    resultingLevel: "HIGH",
    severityReason: "Altura de 3 m",
    status: AssessmentStatus.VALIDATED,
    validatedById: id.Mia,
    validatedAt: new Date(),
    expiresAt: new Date(Date.now() + 1e10),
  });
  o.avaliacaoVigente = nova.id;
  o.avaliacaoSubstituida = (
    await avaliacao(o.risco, {
      status: AssessmentStatus.SUPERSEDED,
      supersededById: nova.id,
      supersededAt: new Date(),
      assessedAt: new Date(Date.now() - 1e9),
    })
  ).id;
  o.avaliacaoRascunho = (await avaliacao(o.riscoRascunho, { status: AssessmentStatus.DRAFT, probability: 1 })).id;

  /* Outra empresa. */
  const org2 = await prisma.organization.create({ data: { name: `C38 outra ${SUFIXO}` } });
  outra.orgId = org2.id;
  outra.filial = (await prisma.establishment.create({ data: { organizationId: org2.id, name: `Fora ${SUFIXO}` } })).id;
});

afterAll(async () => {
  for (const orgId of [empresa.orgId, outra.orgId].filter(Boolean)) {
    await prisma.notification.deleteMany({ where: { organizationId: orgId } });
    await prisma.auditEvent.deleteMany({ where: { organizationId: orgId } });
    await prisma.establishmentCopy.deleteMany({ where: { organizationId: orgId } });
    await prisma.riskAssessment.updateMany({ where: { organizationId: orgId }, data: { supersededById: null } });
    await prisma.riskAssessment.deleteMany({ where: { organizationId: orgId } });
    await prisma.controlMeasure.deleteMany({ where: { organizationId: orgId } });
    await prisma.risk.deleteMany({ where: { organizationId: orgId } });
    await prisma.hazard.deleteMany({ where: { organizationId: orgId } });
    await prisma.activity.deleteMany({ where: { organizationId: orgId } });
    await prisma.jobRoleRequirement.deleteMany({ where: { organizationId: orgId } });
    await prisma.jobRole.deleteMany({ where: { organizationId: orgId } });
    await prisma.sector.deleteMany({ where: { organizationId: orgId } });
    await prisma.training.deleteMany({ where: { organizationId: orgId } });
    await prisma.riskMethodology.deleteMany({ where: { organizationId: orgId } });
  }
  if (!empresa.orgId) return;
  await prisma.accountMembership.deleteMany({ where: { accountId: empresa.contaId } });
  await prisma.membership.deleteMany({ where: { organizationId: empresa.orgId } });
  await prisma.token.deleteMany({ where: { userId: { in: empresa.usuarios } } });
  await prisma.authAttempt.deleteMany({ where: { userId: { in: empresa.usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: empresa.usuarios } } });
  await prisma.establishment.deleteMany({ where: { organizationId: { in: [empresa.orgId, outra.orgId] } } });
  await prisma.account.deleteMany({ where: { id: empresa.contaId } });
  await prisma.organization.deleteMany({ where: { id: { in: [empresa.orgId, outra.orgId] } } });
});

describe("quem copia e para onde [C3-8]", () => {
  it("o Master e o SST abrem a prévia; Dono, RH e gerente não", async () => {
    expect((await previa(token.Sara, f.nova, f.centro)).status).toBe(200);
    expect((await previa(token.Mia, f.nova, f.centro)).status).toBe(200);
    for (const quem of ["Otto", "Rita", "Gil"]) {
      expect((await previa(token[quem], f.nova, f.centro)).status, `prévia de ${quem}`).toBe(403);
      expect((await copiar(token[quem], f.nova, f.centro)).status, `cópia de ${quem}`).toBe(403);
    }
    expect(await prisma.sector.count({ where: { establishmentId: f.nova } })).toBe(0);
  });

  it("origem igual ao destino, de outra empresa, arquivada ou ausente: 400", async () => {
    for (const [destino, origem] of [
      [f.nova, f.nova],
      [f.nova, outra.filial],
      [f.nova, f.velha],
      [f.velha, f.centro],
      [outra.filial, f.centro],
      [f.nova, undefined],
    ] as const) {
      const res = await copiar(token.Sara, destino, origem);
      expect(res.status, `${destino} ← ${origem}`).toBe(400);
      expect(res.body.message).toBe("Filial inválida.");
    }
    expect(await prisma.sector.count({ where: { establishmentId: f.nova } })).toBe(0);
  });
});

describe("a primeira cópia [C3-8]", () => {
  it("a prévia conta o que será criado e não grava nada", async () => {
    const res = await previa(token.Sara, f.nova, f.centro);
    expect(res.status).toBe(200);
    expect(res.body.niveis).toMatchObject({
      setores: { criar: 1, atualizar: 0 },
      funcoes: { criar: 1 },
      atividades: { criar: 1 },
      vinculos: { criar: 1 },
      perigos: { criar: 1 },
      riscos: { criar: 2 },
      medidas: { criar: 1 },
      avaliacoes: { criar: 2 },
      exigencias: { criar: 1 },
    });
    expect(res.body.conflitos).toEqual([]);
    expect(await prisma.sector.count({ where: { establishmentId: f.nova } })).toBe(0);
  });

  it("copia: tudo no destino aponta para o destino", async () => {
    const res = await copiar(token.Sara, f.nova, f.centro);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.contagem.riscos.criados).toBe(2);

    const d = await arvore(f.nova);
    expect(d.setores).toHaveLength(1);
    expect(d.funcoes).toHaveLength(1);
    expect(d.atividades).toHaveLength(1);
    expect(d.perigos).toHaveLength(1);
    expect(d.riscos).toHaveLength(2);
    expect(d.medidas).toHaveLength(1);
    expect(d.avaliacoes).toHaveLength(2);

    for (const x of d.funcoes) expect(x.sector.establishmentId).toBe(f.nova);
    for (const x of d.atividades) {
      expect(x.establishmentId).toBe(f.nova);
      expect(x.sector.establishmentId).toBe(f.nova);
      expect(x.jobRoles.map((v) => v.jobRole.sector.establishmentId)).toEqual([f.nova]);
    }
    for (const x of d.perigos) expect(x.activity.establishmentId).toBe(f.nova);
    for (const x of d.riscos) expect(x.hazard.activity.establishmentId).toBe(f.nova);
    for (const x of d.medidas) expect(x.risk.hazard.activity.establishmentId).toBe(f.nova);
    for (const x of d.avaliacoes) expect(x.risk.hazard.activity.establishmentId).toBe(f.nova);
    expect(d.funcoes[0].requirements).toHaveLength(1);
    expect(d.funcoes[0].requirements[0]).toMatchObject({
      trainingId: o.treinamento,
      name: "Altura",
      validityMonths: 24,
      copiedFromId: o.exigencia,
    });

    /* Procedência. */
    expect(d.setores[0]).toMatchObject({ copiedFromId: o.setor, name: "Vendas", processDescription: "Atender" });
    expect(d.funcoes[0].copiedFromId).toBe(o.funcao);
    expect(d.atividades[0].copiedFromId).toBe(o.atividade);
    for (const x of [...d.setores, ...d.funcoes, ...d.atividades, ...d.perigos, ...d.riscos, ...d.medidas, ...d.avaliacoes]) {
      expect(x.copiedAt).toBeInstanceOf(Date);
    }

    /* Como cada item chega [R11]. */
    expect(d.perigos[0]).toMatchObject({
      copiedFromId: o.perigo,
      aepId: null,
      createdById: id.Sara,
      source: "Escada",
      exposedWorkersCount: 4,
      status: "CONFIRMED",
    });
    const fratura = d.riscos.find((r) => r.copiedFromId === o.risco)!;
    expect(fratura).toMatchObject({ description: "Fratura", needsReassessment: false, reassessmentReason: null });
    expect(d.medidas[0]).toMatchObject({
      copiedFromId: o.medida,
      riskId: fratura.id,
      status: "PLANNED",
      implementedAt: null,
      effectivenessStatus: null,
    });
    const daFratura = d.avaliacoes.find((a) => a.riskId === fratura.id)!;
    expect(daFratura).toMatchObject({
      copiedFromId: o.avaliacaoVigente,
      status: "IN_REVIEW",
      assessorId: id.Sara,
      severity: 4,
      resultingLevel: "HIGH",
      severityReason: "Altura de 3 m",
      validatedById: null,
      validatedAt: null,
      expiresAt: null,
      supersededById: null,
    });
    const daEntorse = d.avaliacoes.find((a) => a.riskId !== fratura.id)!;
    expect(daEntorse).toMatchObject({ copiedFromId: o.avaliacaoRascunho, status: "IN_REVIEW", probability: 1 });

    /* A origem não muda. */
    const origem = await arvore(f.centro);
    expect(origem.setores).toHaveLength(2);
    expect(origem.avaliacoes).toHaveLength(3);
    expect((await prisma.controlMeasure.findUnique({ where: { id: o.medida } }))!.status).toBe("IMPLEMENTED");

    /* Registro e trilha. */
    const registro = await prisma.establishmentCopy.findMany({ where: { organizationId: orgDe() } });
    expect(registro).toHaveLength(1);
    expect(registro[0]).toMatchObject({ sourceEstablishmentId: f.centro, targetEstablishmentId: f.nova, copiedById: id.Sara });
    const trilha = await prisma.auditEvent.count({
      where: { organizationId: orgDe(), action: "establishment.copy", entityId: f.nova },
    });
    expect(trilha).toBe(1);
  });

  it("os outros SSTs e o Master são avisados; quem copiou, não", async () => {
    const avisados = await prisma.notification.findMany({
      where: { organizationId: orgDe(), kind: "UNIT_COPY_AWAITING_VALIDATION" },
      select: { userId: true },
    });
    expect(avisados.map((a) => a.userId).sort()).toEqual([id.Tito, id.Mia].sort());
  });

  it("quem copiou não valida a avaliação copiada; outro SST valida", async () => {
    const copia = await prisma.riskAssessment.findFirstOrThrow({
      where: { copiedFromId: o.avaliacaoVigente, risk: { hazard: { activity: { establishmentId: f.nova } } } },
    });
    const sara = await request(app).post(`/api/assessments/${copia.id}/validate`).set(as(token.Sara));
    expect(sara.status).toBe(403);
    const tito = await request(app).post(`/api/assessments/${copia.id}/validate`).set(as(token.Tito));
    expect(tito.status, JSON.stringify(tito.body)).toBe(200);
  });
});

describe("copiar de novo [C3-8]", () => {
  it("sem mudança: nada criado, nada atualizado, nada duplicado", async () => {
    const res = await copiar(token.Sara, f.nova, f.centro);
    expect(res.status).toBe(200);
    for (const [nivel, c] of Object.entries(res.body.contagem as Record<string, { criados: number; atualizados: number }>)) {
      expect(c, nivel).toEqual({ criados: 0, atualizados: 0 });
    }
    const d = await arvore(f.nova);
    expect(d.setores).toHaveLength(1);
    expect(d.riscos).toHaveLength(2);
    expect(d.avaliacoes, "a validada pelo Tito continua sendo a única da fratura").toHaveLength(2);
  });

  it("a origem mudou e o destino não: o destino recebe a mudança", async () => {
    await prisma.sector.update({ where: { id: o.setor }, data: { name: "Vendas e caixa" } });
    const antes = (await prisma.sector.findFirstOrThrow({ where: { establishmentId: f.nova } })).copiedAt!;
    const p = await previa(token.Sara, f.nova, f.centro);
    expect(p.body.niveis.setores).toMatchObject({ criar: 0, atualizar: 1 });
    const res = await copiar(token.Sara, f.nova, f.centro);
    expect(res.body.contagem.setores).toEqual({ criados: 0, atualizados: 1 });
    const setor = await prisma.sector.findFirstOrThrow({ where: { establishmentId: f.nova } });
    expect(setor.name).toBe("Vendas e caixa");
    expect(setor.copiedAt!.getTime()).toBeGreaterThan(antes.getTime());
    expect(setor.updatedAt.getTime()).toBe(setor.copiedAt!.getTime());
  });

  it("o destino mudou: conflito com a diferença; sem aceitar, o destino fica", async () => {
    const riscoD = await prisma.risk.findFirstOrThrow({
      where: { copiedFromId: o.risco, hazard: { activity: { establishmentId: f.nova } } },
    });
    await prisma.risk.update({ where: { id: riscoD.id }, data: { description: "Fratura no piso molhado" } });
    await prisma.risk.update({ where: { id: o.risco }, data: { description: "Fratura por queda" } });

    const p = await previa(token.Sara, f.nova, f.centro);
    expect(p.body.conflitos).toEqual([
      {
        nivel: "riscos",
        id: riscoD.id,
        nome: "Fratura no piso molhado",
        campos: [{ campo: "description", destino: "Fratura no piso molhado", origem: "Fratura por queda" }],
      },
    ]);
    expect(p.body.niveis.riscos.atualizar).toBe(0);

    const res = await copiar(token.Sara, f.nova, f.centro);
    expect(res.status).toBe(200);
    expect(res.body.ignorados.map((c: { id: string }) => c.id)).toEqual([riscoD.id]);
    expect((await prisma.risk.findUniqueOrThrow({ where: { id: riscoD.id } })).description).toBe("Fratura no piso molhado");
  });

  it("aceitando o conflito, o destino recebe a origem", async () => {
    const riscoD = await prisma.risk.findFirstOrThrow({
      where: { copiedFromId: o.risco, hazard: { activity: { establishmentId: f.nova } } },
    });
    const res = await copiar(token.Sara, f.nova, f.centro, [riscoD.id]);
    expect(res.status).toBe(200);
    expect(res.body.ignorados).toEqual([]);
    expect(res.body.contagem.riscos).toEqual({ criados: 0, atualizados: 1 });
    const depois = await prisma.risk.findUniqueOrThrow({ where: { id: riscoD.id } });
    expect(depois.description).toBe("Fratura por queda");
    expect(depois.updatedAt.getTime()).toBe(depois.copiedAt!.getTime());
  });

  it("o estado do destino não é sobrescrito: a medida implantada lá continua implantada", async () => {
    const medidaD = await prisma.controlMeasure.findFirstOrThrow({
      where: { copiedFromId: o.medida, risk: { hazard: { activity: { establishmentId: f.nova } } } },
    });
    await prisma.controlMeasure.update({
      where: { id: medidaD.id },
      data: { status: "IMPLEMENTED", implementedAt: new Date() },
    });
    await prisma.controlMeasure.update({ where: { id: o.medida }, data: { description: "Cinto e talabarte" } });
    const res = await copiar(token.Sara, f.nova, f.centro, [medidaD.id]);
    expect(res.status).toBe(200);
    const depois = await prisma.controlMeasure.findUniqueOrThrow({ where: { id: medidaD.id } });
    expect(depois).toMatchObject({ description: "Cinto e talabarte", status: "IMPLEMENTED" });
  });

  it("o que surgiu na origem depois da cópia é criado, com o vínculo", async () => {
    const funcao = await prisma.jobRole.create({
      data: { organizationId: orgDe(), sectorId: o.setor, name: "Estoquista" },
    });
    await prisma.activityJobRole.create({ data: { activityId: o.atividade, jobRoleId: funcao.id } });
    const res = await copiar(token.Sara, f.nova, f.centro);
    expect(res.body.contagem.funcoes.criados).toBe(1);
    expect(res.body.contagem.vinculos.criados).toBe(1);
    const atividade = await prisma.activity.findFirstOrThrow({
      where: { establishmentId: f.nova },
      include: { jobRoles: { include: { jobRole: true } } },
    });
    expect(atividade.jobRoles.map((v) => v.jobRole.name).sort()).toEqual(["Estoquista", "Vendedor"]);
    for (const v of atividade.jobRoles) expect(v.jobRole.copiedFromId).not.toBeNull();
  });

  it("uma avaliação validada nova na origem chega como cópia nova, em revisão", async () => {
    const base = {
      organizationId: orgDe(),
      riskId: o.riscoRascunho,
      methodologyVersionId: versao,
      probability: 1,
      resultingLevel: "LOW",
      assessorId: id.Tito,
    };
    const validada = await prisma.riskAssessment.create({
      data: { ...base, severity: 2, status: AssessmentStatus.VALIDATED, validatedById: id.Mia, validatedAt: new Date() },
    });
    /* Um rascunho mais novo não vence a validada. */
    await prisma.riskAssessment.create({
      data: { ...base, severity: 5, status: AssessmentStatus.DRAFT, assessedAt: new Date(Date.now() + 60_000) },
    });
    const p = await previa(token.Sara, f.nova, f.centro);
    expect(p.body.niveis.avaliacoes.criar).toBe(1);
    const res = await copiar(token.Sara, f.nova, f.centro);
    expect(res.status).toBe(200);
    expect(res.body.contagem.avaliacoes.criados).toBe(1);
    const entorse = await prisma.riskAssessment.findMany({
      where: { risk: { copiedFromId: o.riscoRascunho, hazard: { activity: { establishmentId: f.nova } } } },
      orderBy: { createdAt: "asc" },
    });
    expect(entorse.map((a) => a.copiedFromId)).toEqual([o.avaliacaoRascunho, validada.id]);
    expect(entorse[1]).toMatchObject({ status: "IN_REVIEW", severity: 2, assessorId: id.Sara });
  });
});

describe("duas cópias ao mesmo tempo [C3-8]", () => {
  it("uma grava, a outra recebe 409, e nada é duplicado", async () => {
    const [a, b] = await Promise.all([copiar(token.Sara, f.dois, f.centro), copiar(token.Mia, f.dois, f.centro)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const recusada = a.status === 409 ? a : b;
    expect(recusada.body.message).toBe("Outra cópia para esta filial terminou agora. Abra a prévia de novo.");
    const d = await arvore(f.dois);
    expect(d.setores).toHaveLength(1);
    expect(d.funcoes).toHaveLength(2);
    expect(d.riscos).toHaveLength(2);
    expect(await prisma.establishmentCopy.count({ where: { targetEstablishmentId: f.dois } })).toBe(1);
  });
});

describe("volume [C3-8]", () => {
  it("300 riscos, com medida e avaliação, copiados de uma vez", async () => {
    const setor = await prisma.sector.create({
      data: { organizationId: orgDe(), establishmentId: f.grande, name: "Depósito" },
    });
    const atividade = await prisma.activity.create({
      data: { organizationId: orgDe(), establishmentId: f.grande, sectorId: setor.id, name: "Empilhar" },
    });
    for (let p = 0; p < 30; p++) {
      const perigo = await prisma.hazard.create({
        data: { organizationId: orgDe(), activityId: atividade.id, description: `Perigo ${p}`, createdById: id.Tito },
      });
      const riscos = Array.from({ length: 10 }, (_, r) => ({
        id: `${SUFIXO}-${p}-${r}-`.padEnd(36, "0"),
        organizationId: orgDe(),
        hazardId: perigo.id,
        description: `Risco ${p}.${r}`,
      }));
      await prisma.risk.createMany({ data: riscos });
      await prisma.controlMeasure.createMany({
        data: riscos.map((r) => ({ organizationId: orgDe(), riskId: r.id, type: "ADMINISTRATIVE" as const, description: "Pausa" })),
      });
      await prisma.riskAssessment.createMany({
        data: riscos.map((r) => ({
          organizationId: orgDe(),
          riskId: r.id,
          methodologyVersionId: versao,
          severity: 2,
          probability: 2,
          resultingLevel: "MEDIUM",
          assessorId: id.Tito,
          status: AssessmentStatus.VALIDATED,
        })),
      });
    }
    const destino = await prisma.establishment.create({
      data: { organizationId: orgDe(), name: `Loja Grande 2 ${SUFIXO}` },
    });
    const inicio = Date.now();
    const res = await copiar(token.Sara, destino.id, f.grande);
    const ms = Date.now() - inicio;
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    expect(res.body.contagem.riscos.criados).toBe(300);
    expect(res.body.contagem.medidas.criados).toBe(300);
    expect(res.body.contagem.avaliacoes.criados).toBe(300);
    expect(ms, `a cópia levou ${ms} ms`).toBeLessThan(30_000);
    console.log(`cópia de 300 riscos: ${ms} ms`);
  });
});

describe("validar a avaliação copiada [C4-2]", () => {
  let destino = "";
  let copiada = "";
  let riscoCopiado = "";

  it("a avaliação copiada aparece em revisão, com a filial de origem, no inventário e no Início", async () => {
    destino = (
      await prisma.establishment.create({ data: { organizationId: orgDe(), name: `Loja Valida ${SUFIXO}` } })
    ).id;
    const res = await copiar(token.Sara!, destino, f.centro);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    riscoCopiado = (
      await prisma.risk.findFirstOrThrow({
        where: { organizationId: orgDe(), copiedFromId: o.risco, hazard: { activity: { establishmentId: destino } } },
      })
    ).id;

    const lista = await request(app).get(`/api/assessments?risk_id=${riscoCopiado}`).set(as(token.Tito!));
    expect(lista.status).toBe(200);
    const [a] = lista.body.assessments;
    expect(a).toMatchObject({ status: "IN_REVIEW", copied_from_establishment: `Loja Centro ${SUFIXO}` });
    copiada = a.id;

    const inv = await request(app).get(`/api/inventory?establishment_id=${destino}`).set(as(token.Tito!));
    expect(inv.status).toBe(200);
    const risco = inv.body.inventory.items
      .flatMap((h: { risks: { risk_id: string }[] }) => h.risks)
      .find((r: { risk_id: string }) => r.risk_id === riscoCopiado);
    expect(risco).toMatchObject({ level: null, pending_level: "HIGH", pending_in_review: true });

    const riscos = await request(app)
      .get(`/api/risks?hazard_id=${(await prisma.risk.findUniqueOrThrow({ where: { id: riscoCopiado } })).hazardId}`)
      .set(as(token.Tito!));
    expect(riscos.body.risks.find((r: { id: string }) => r.id === riscoCopiado).awaiting_validation).toBe(true);

    const inicio = await request(app).get("/api/inicio").set(as(token.Tito!));
    const cartao = inicio.body.desk.find((c: { id: string }) => c.id === "avaliacoes_rascunho");
    const emRevisao = await prisma.riskAssessment.count({ where: { organizationId: orgDe(), status: "IN_REVIEW" } });
    const rascunhos = await prisma.riskAssessment.count({ where: { organizationId: orgDe(), status: "DRAFT" } });
    expect(emRevisao).toBeGreaterThan(0);
    expect(cartao?.count).toBe(rascunhos + emRevisao);

    const aviso = await prisma.notification.findFirstOrThrow({
      where: { organizationId: orgDe(), kind: "UNIT_COPY_AWAITING_VALIDATION", userId: id.Tito },
      orderBy: { createdAt: "desc" },
    });
    expect(aviso.link).toBe(`/inventario?unidade=${destino}`);
  });

  it("quem copiou não valida; o outro SST valida, e o inventário passa a mostrar o nível", async () => {
    const dele = await request(app).post(`/api/assessments/${copiada}/validate`).set(as(token.Sara!));
    expect(dele.status).toBe(403);
    const ok = await request(app).post(`/api/assessments/${copiada}/validate`).set(as(token.Tito!));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const inv = await request(app).get(`/api/inventory?establishment_id=${destino}`).set(as(token.Tito!));
    const risco = inv.body.inventory.items
      .flatMap((h: { risks: { risk_id: string }[] }) => h.risks)
      .find((r: { risk_id: string }) => r.risk_id === riscoCopiado);
    expect(risco).toMatchObject({ level: "HIGH", pending_level: null, pending_in_review: false });
  });
});
