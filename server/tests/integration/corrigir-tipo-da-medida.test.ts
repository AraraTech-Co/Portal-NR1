import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { mudancasDesdeAEmissao } from "../../src/helper/ordem-desatualizada";

/**
 * A medida registrada com o tipo errado se corrige. [B3-2-D]
 *
 * A medida da placa, registrada como EPI antes de existir "EPC", continuava
 * EPI no inventário e na ordem de serviço: não havia edição de medida. Agora
 * o tipo se corrige, com trilha no risco — e a ordem de serviço já emitida
 * conta a correção como mudança desde a emissão.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let sst = "";
let colaborador = "";
let risco = "";
const medidas: string[] = [];
let outraEmpresa = "";

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body.token as string;
}

async function medida(type: string) {
  const res = await request(app)
    .post("/api/controls")
    .set(as(sst))
    .send({ risk_id: risco, type, description: `Proteção da placa ${SUFIXO}` });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  medidas.push(res.body.control.id);
  return res.body.control.id as string;
}

beforeAll(async () => {
  app = createApp();
  sst = await entrar("teste.sst");
  colaborador = await entrar("teste.colaborador");
  risco = (
    await prisma.risk.findFirstOrThrow({
      where: {
        organizationId: ORG,
        archivedAt: null,
        hazard: { activity: { jobRoles: { some: {} } } },
      },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  if (outraEmpresa) await prisma.organization.deleteMany({ where: { id: outraEmpresa } });
  await prisma.auditEvent.deleteMany({
    where: { entityId: risco, action: { in: ["control.create", "control.update"] }, createdAt: { gte: new Date(Date.now() - 3_600_000) }, after: { path: ["description"], equals: `Proteção da placa ${SUFIXO}` } },
  });
  await prisma.controlMeasure.deleteMany({ where: { id: { in: medidas } } });
});

describe("corrigir o tipo da medida [B3-2-D]", () => {
  it("EPI vira EPC, com o antes e o depois na trilha do risco", async () => {
    const id = await medida("PPE");
    const res = await request(app).patch(`/api/controls/${id}`).set(as(sst)).send({ type: "ENGINEERING" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await prisma.controlMeasure.findUniqueOrThrow({ where: { id } })).type).toBe("ENGINEERING");

    const trilha = await prisma.auditEvent.findFirstOrThrow({
      where: { entityId: risco, action: "control.update" },
      orderBy: { createdAt: "desc" },
    });
    expect(trilha.entityType).toBe("Risk");
    expect(trilha.before).toMatchObject({ type: "PPE" });
    expect(trilha.after).toMatchObject({ type: "ENGINEERING", description: `Proteção da placa ${SUFIXO}` });
  });

  it("a ordem de serviço da função conta a correção como mudança desde a emissão", async () => {
    const id = await medida("PPE");
    const funcao = await prisma.jobRole.findFirstOrThrow({
      where: { activities: { some: { activity: { hazards: { some: { risks: { some: { id: risco } } } } } } } },
      select: { id: true },
    });
    const emissao = new Date();
    const antes = await mudancasDesdeAEmissao(ORG, funcao.id, emissao);
    await request(app).patch(`/api/controls/${id}`).set(as(sst)).send({ type: "ENGINEERING" }).expect(200);
    expect(await mudancasDesdeAEmissao(ORG, funcao.id, emissao)).toBeGreaterThan(antes);
  });

  it("tipo que não existe é recusado; o mesmo tipo não grava trilha", async () => {
    const id = await medida("ADMINISTRATIVE");
    const invalido = await request(app).patch(`/api/controls/${id}`).set(as(sst)).send({ type: "EPC" });
    expect(invalido.status).toBe(400);
    const antes = await prisma.auditEvent.count({ where: { entityId: risco, action: "control.update" } });
    const igual = await request(app).patch(`/api/controls/${id}`).set(as(sst)).send({ type: "ADMINISTRATIVE" });
    expect(igual.status).toBe(200);
    expect(await prisma.auditEvent.count({ where: { entityId: risco, action: "control.update" } })).toBe(antes);
  });

  it("quem só lê o inventário não corrige, e medida de outra empresa não se acha", async () => {
    const id = await medida("PPE");
    const res = await request(app).patch(`/api/controls/${id}`).set(as(colaborador)).send({ type: "ENGINEERING" });
    expect(res.status).toBe(403);
    expect((await prisma.controlMeasure.findUniqueOrThrow({ where: { id } })).type).toBe("PPE");
    /* Medida de outra empresa: o id existe, mas não é desta. */
    const org = await prisma.organization.create({ data: { name: `Outra ${SUFIXO}` } });
    outraEmpresa = org.id;
    const est = await prisma.establishment.create({ data: { organizationId: org.id, name: "Unidade" } });
    const setor = await prisma.sector.create({
      data: { organizationId: org.id, establishmentId: est.id, name: "Setor" },
    });
    const atividade = await prisma.activity.create({
      data: { organizationId: org.id, establishmentId: est.id, sectorId: setor.id, name: "Atividade" },
    });
    const sstId = (await prisma.user.findUniqueOrThrow({ where: { login: "teste.sst" } })).id;
    const perigo = await prisma.hazard.create({
      data: {
        organizationId: org.id,
        activityId: atividade.id,
        description: "Perigo",
        category: "ACCIDENT",
        status: "IDENTIFIED",
        origin: "ROUTINE_REVIEW",
        createdById: sstId,
      },
    });
    const riscoAlheio = await prisma.risk.create({
      data: { organizationId: org.id, hazardId: perigo.id, description: "Risco" },
    });
    const alheia = await prisma.controlMeasure.create({
      data: { organizationId: org.id, riskId: riscoAlheio.id, type: "PPE", description: "Alheia", status: "PLANNED" },
    });
    const cruzada = await request(app)
      .patch(`/api/controls/${alheia.id}`)
      .set(as(sst))
      .send({ type: "ENGINEERING" });
    expect(cruzada.status).toBe(404);
    expect((await prisma.controlMeasure.findUniqueOrThrow({ where: { id: alheia.id } })).type).toBe("PPE");

    const inexistente = await request(app)
      .patch("/api/controls/00000000-0000-4000-8000-000000000000")
      .set(as(sst))
      .send({ type: "ENGINEERING" });
    expect(inexistente.status).toBe(404);
  });
});

describe("a tela oferece a correção a quem escreve [B3-2-D]", () => {
  const tela = readFileSync(
    join(__dirname, "..", "..", "..", "client", "src", "pages", "ControlActionPanel.tsx"),
    "utf8",
  )
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ");

  it("'Corrigir tipo' só para quem escreve, e salva o tipo escolhido", () => {
    expect(tela).toContain("{canWrite && corrigindo !== c.id && (");
    expect(tela).toContain("await updateControlType(controlId, tipoCorrigido);");
    expect(tela).toContain("disabled={salvandoTipo || tipoCorrigido === c.type}");
  });
});
