import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Emergência e participação param de guardar sem mostrar.
 *
 * O plano (primeiros socorros, responsáveis, saída) e o simulado
 * (participantes, achados) não abriam em tela nenhuma, e a Participação pedia
 * a evidência que não tinha como anexar. Anexar pelo servidor também não
 * bastava: a rota que serve arquivo de evidência só atende evidência de ação,
 * então a prova entrava e não saía — e é o fiscal quem pede para ver.
 * [B3-4-B] [S7-E]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let sst = "";
let fiscal = "";
let unidade = "";
let procedimento = "";
let simulado = "";
let participacao = "";

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body.token as string;
}

beforeAll(async () => {
  app = createApp();
  sst = await entrar("teste.sst");
  fiscal = await entrar("teste.fiscal");

  const est = await prisma.establishment.findFirstOrThrow({
    where: { organizationId: ORG_ID, archivedAt: null },
    select: { id: true },
  });
  unidade = est.id;

  const proc = await request(app)
    .post("/api/emergency-procedures")
    .set(as(sst))
    .send({
      establishment_id: unidade,
      scenario: `Incêndio na usinagem ${SUFIXO}`,
      first_aid_means: `Maleta na portaria ${SUFIXO}`,
      responsibles: `Brigada do turno ${SUFIXO}`,
      evacuation_plan: `Ponto de encontro no pátio ${SUFIXO}`,
    });
  expect(proc.status, JSON.stringify(proc.body)).toBe(201);
  procedimento = proc.body.procedure.id;

  const drill = await request(app)
    .post(`/api/emergency-procedures/${procedimento}/drills`)
    .set(as(sst))
    .send({
      performed_at: new Date("2026-10-20T14:00:00.000Z").toISOString(),
      participants: 12,
      findings: `Porta lateral estava travada ${SUFIXO}`,
    });
  expect(drill.status, JSON.stringify(drill.body)).toBe(201);
  simulado = drill.body.drill.id;

  const part = await request(app)
    .post("/api/participations")
    .set(as(sst))
    .send({
      type: "CONSULTATION",
      subject: `DDS da proteção da placa ${SUFIXO}`,
      occurred_at: new Date("2026-10-21T12:00:00.000Z").toISOString(),
      establishment_id: unidade,
      participants_count: 8,
      description: `O que foi tratado ${SUFIXO}`,
    });
  expect(part.status, JSON.stringify(part.body)).toBe(201);
  participacao = part.body.participation.id;
});

afterAll(async () => {
  await prisma.evidence.deleteMany({
    where: { OR: [{ drillId: simulado }, { participationId: participacao }] },
  });
  await prisma.emergencyDrill.deleteMany({ where: { id: simulado } });
  await prisma.emergencyProcedure.deleteMany({ where: { id: procedimento } });
  await prisma.participationRecord.deleteMany({ where: { id: participacao } });
  await prisma.action.deleteMany({
    where: { organizationId: ORG_ID, title: { contains: SUFIXO } },
  });
});

describe("o plano de emergência abre [B3-4-B] [S7-E]", () => {
  it("o procedimento devolve o plano inteiro e os simulados, com os achados", async () => {
    const res = await request(app)
      .get(`/api/emergency-procedures/${procedimento}`)
      .set(as(sst));
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    const p = res.body.procedure;
    expect(p.firstAidMeans).toContain(SUFIXO);
    expect(p.responsibles).toContain(SUFIXO);
    expect(p.evacuationPlan).toContain(SUFIXO);
    expect(p.drills.length).toBe(1);
    expect(p.drills[0].findings).toContain("Porta lateral");
    expect(p.drills[0].participants).toBe(12);
    /* A tela de detalhe lista e baixa a ata: precisa das evidências. */
    expect(Array.isArray(p.drills[0].evidences), "as evidências vêm junto").toBe(true);
  });

  it("o fiscal, que só consulta, vê o mesmo plano", async () => {
    const res = await request(app)
      .get(`/api/emergency-procedures/${procedimento}`)
      .set(as(fiscal));
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    expect(res.body.procedure.evacuationPlan).toContain(SUFIXO);
  });
});

describe("a ata do simulado entra e sai [B3-4-B] [B3-4-F]", () => {
  let evidenciaDoSimulado = "";

  it("anexar a ata e baixá-la de volta", async () => {
    const envio = await request(app)
      .post(`/api/emergency-procedures/${procedimento}/drills/${simulado}/evidences`)
      .set(as(sst))
      .send({
        file_name: "ata-assinada.png",
        mime_type: "image/png",
        content_base64: PNG.toString("base64"),
        description: "Ata assinada pelos participantes",
      });
    expect(envio.status, JSON.stringify(envio.body)).toBe(201);
    evidenciaDoSimulado = envio.body.evidence.id;

    const baixa = await request(app)
      .get(
        `/api/emergency-procedures/${procedimento}/drills/${simulado}/evidences/${evidenciaDoSimulado}/file`,
      )
      .set(as(sst));
    /*
      É aqui que estava o buraco: a rota de evidência só atendia evidência de
      ação, então a ata entrava e não saía.
    */
    expect(baixa.status, JSON.stringify(baixa.body).slice(0, 120)).toBe(200);
    expect(baixa.body.length).toBeGreaterThan(0);
  });

  it("o fiscal baixa a ata, que é o que ele pede para ver", async () => {
    const res = await request(app)
      .get(
        `/api/emergency-procedures/${procedimento}/drills/${simulado}/evidences/${evidenciaDoSimulado}/file`,
      )
      .set(as(fiscal));
    expect(res.status, JSON.stringify(res.body).slice(0, 120)).toBe(200);
  });

  it("a ata de um simulado não sai pelo endereço de outro", async () => {
    const outro = await request(app)
      .post(`/api/emergency-procedures/${procedimento}/drills`)
      .set(as(sst))
      .send({ performed_at: new Date("2026-09-10T14:00:00.000Z").toISOString() });
    expect(outro.status).toBe(201);
    const res = await request(app)
      .get(
        `/api/emergency-procedures/${procedimento}/drills/${outro.body.drill.id}/evidences/${evidenciaDoSimulado}/file`,
      )
      .set(as(sst));
    expect(res.status, "cada evidência é do seu simulado").toBe(404);
    await prisma.emergencyDrill.deleteMany({ where: { id: outro.body.drill.id } });
  });
});

describe("a evidência da participação entra e sai [B3-4-B] [S7-E]", () => {
  it("o registro abre com o que foi tratado e com a evidência", async () => {
    const envio = await request(app)
      .post(`/api/participations/${participacao}/evidences`)
      .set(as(sst))
      .send({
        file_name: "lista-de-presenca.png",
        mime_type: "image/png",
        content_base64: PNG.toString("base64"),
        description: "Lista de presença assinada",
      });
    expect(envio.status, JSON.stringify(envio.body)).toBe(201);
    const evidenciaId = envio.body.evidence.id as string;

    const aberto = await request(app)
      .get(`/api/participations/${participacao}`)
      .set(as(sst));
    expect(aberto.status).toBe(200);
    expect(aberto.body.participation.description).toContain(SUFIXO);
    expect(aberto.body.participation.evidences.length).toBe(1);

    const baixa = await request(app)
      .get(`/api/participations/${participacao}/evidences/${evidenciaId}/file`)
      .set(as(sst));
    expect(baixa.status, JSON.stringify(baixa.body).slice(0, 120)).toBe(200);

    const peloFiscal = await request(app)
      .get(`/api/participations/${participacao}/evidences/${evidenciaId}/file`)
      .set(as(fiscal));
    expect(peloFiscal.status, "o fiscal também vê").toBe(200);
  });

  it("a evidência de uma participação não sai pelo endereço de outra", async () => {
    const outra = await request(app)
      .post("/api/participations")
      .set(as(sst))
      .send({
        type: "CONSULTATION",
        subject: `Outra participação ${SUFIXO}`,
        occurred_at: new Date("2026-10-22T12:00:00.000Z").toISOString(),
      });
    expect(outra.status).toBe(201);

    const minha = await request(app)
      .get(`/api/participations/${participacao}`)
      .set(as(sst));
    const evidenciaId = minha.body.participation.evidences[0].id as string;

    const res = await request(app)
      .get(`/api/participations/${outra.body.participation.id}/evidences/${evidenciaId}/file`)
      .set(as(sst));
    expect(res.status, "cada evidência é do seu registro").toBe(404);
    await prisma.participationRecord.deleteMany({
      where: { id: outra.body.participation.id },
    });
  });
});

describe("o achado do simulado vira ação do plano [B3-4-B]", () => {
  it("a ação é aceita sem risco ligado, com responsável e prazo", async () => {
    const pessoa = await prisma.membership.findFirstOrThrow({
      where: { organizationId: ORG_ID, suspendedAt: null, user: { active: true } },
      select: { userId: true },
    });
    const res = await request(app)
      .post("/api/actions")
      .set(as(sst))
      .send({
        effectiveness_criteria: "Critério do teste",
        title: `Trocar a fechadura da porta lateral ${SUFIXO}`,
        description: `Achado do simulado de emergência: Porta lateral estava travada ${SUFIXO}`,
        assignee_id: pessoa.userId,
        due_date: "2027-01-20",
        priority: "HIGH",
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const gravada = await prisma.action.findFirstOrThrow({
      where: { id: res.body.action.id },
      select: { riskId: true, description: true },
    });
    expect(gravada.riskId, "achado de simulado não vem de risco avaliado").toBeNull();
    expect(gravada.description).toContain("simulado");
  });
});
