import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O prazo da ação deixa de ser palpite.
 *
 * O prazo sugerido pelo nível do risco virou limite: passar dele exige dizer
 * por quê [S2-M], e data no passado é recusada [CB-21]. O responsável não
 * pode estar suspenso [CB-23]. E validar a ação passa a poder pedir a
 * reavaliação do risco [S3-N] [CB-20].
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let sst: { token: string; user: { id: string } };
let supervisor: { token: string; user: { id: string } };

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

function emDias(dias: number): string {
  return new Date(Date.now() - 3 * 3_600_000 + dias * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Um risco com avaliação validada no nível pedido. */
async function riscoNoNivel(nivel: string, nome: string) {
  const est = (
    await request(app)
      .post("/api/establishments")
      .set(as(sst.token))
      .send({ name: `${nome} ${SUFIXO}` })
  ).body.establishment;
  const setor = (
    await request(app)
      .post("/api/sectors")
      .set(as(sst.token))
      .send({ establishment_id: est.id, name: "Produção" })
  ).body.sector;
  const atividade = (
    await request(app).post("/api/activities").set(as(sst.token)).send({
      establishment_id: est.id,
      sector_id: setor.id,
      name: `Operar ${nome} ${SUFIXO}`,
      description: "Opera a máquina do setor",
    })
  ).body.activity;
  const perigo = (
    await request(app).post("/api/hazards").set(as(sst.token)).send({
      activity_id: atividade.id,
      description: `Peça girando ${nome} ${SUFIXO}`,
      category: "ACCIDENT",
    })
  ).body.hazard;
  const risco = (
    await request(app)
      .post("/api/risks")
      .set(as(sst.token))
      .send({ hazard_id: perigo.id, description: `Corte ${nome} ${SUFIXO}` })
  ).body.risk;

  // A avaliação é gravada direto: o caminho dela tem teste próprio.
  const metodologia = await prisma.riskMethodologyVersion.findFirstOrThrow({
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  await prisma.riskAssessment.create({
    data: {
      organizationId: ORG_ID,
      riskId: risco.id,
      methodologyVersionId: metodologia.id,
      severity: 4,
      probability: 4,
      resultingLevel: nivel,
      status: "VALIDATED",
      assessorId: sst.user.id,
      validatedById: sst.user.id,
      validatedAt: new Date(),
    },
  });
  return { riskId: risco.id as string, establishmentId: est.id as string };
}

const abrirAcao = (body: Record<string, unknown>) =>
  request(app).post("/api/actions").set(as(sst.token)).send(body);

beforeAll(async () => {
  app = createApp();
  sst = await entrar("teste.sst");
  supervisor = await entrar("teste.supervisor");
});

describe("o prazo do nível é limite, não palpite [S2-M]", () => {
  it("risco Substancial recusa 90 dias sem justificativa e diz o limite", async () => {
    const { riskId } = await riscoNoNivel("SUBSTANTIAL", "Alfa");

    const longe = await abrirAcao({
      title: `Entregar luvas ${SUFIXO}`,
      risk_id: riskId,
      priority: "HIGH",
      assignee_id: supervisor.user.id,
      due_date: emDias(90),
    });
    expect(longe.status).toBe(400);
    expect(longe.body.code).toBe("DEADLINE_NEEDS_JUSTIFICATION");
    expect(longe.body.limit_days, "Substancial pede 30 dias").toBe(30);
    expect(longe.body.message).toMatch(/Substancial/);
  });

  it("com justificativa, passa — e o motivo fica gravado", async () => {
    const { riskId } = await riscoNoNivel("SUBSTANTIAL", "Beta");

    const res = await abrirAcao({
      title: `Trocar proteção ${SUFIXO}`,
      risk_id: riskId,
      priority: "HIGH",
      assignee_id: supervisor.user.id,
      due_date: emDias(90),
      deadline_justification: "Depende da parada de máquina de janeiro.",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const gravada = await prisma.action.findFirstOrThrow({
      where: { id: res.body.action.id },
      select: { deadlineJustification: true },
    });
    expect(gravada.deadlineJustification).toMatch(/parada de máquina/);
  });

  it("dentro do limite, nem pede justificativa nem guarda uma", async () => {
    const { riskId } = await riscoNoNivel("SUBSTANTIAL", "Gama");

    const res = await abrirAcao({
      title: `Sinalizar piso ${SUFIXO}`,
      risk_id: riskId,
      priority: "HIGH",
      assignee_id: supervisor.user.id,
      due_date: emDias(20),
      deadline_justification: "não era necessária",
    });
    expect(res.status).toBe(201);

    const gravada = await prisma.action.findFirstOrThrow({
      where: { id: res.body.action.id },
      select: { deadlineJustification: true },
    });
    expect(gravada.deadlineJustification, "não guarda motivo que não precisou").toBeNull();
  });

  it("o nível mais grave aperta mais: Intolerável pede 7 dias", async () => {
    const { riskId } = await riscoNoNivel("INTOLERABLE", "Delta");

    const res = await abrirAcao({
      title: `Parar a máquina ${SUFIXO}`,
      risk_id: riskId,
      priority: "CRITICAL",
      assignee_id: supervisor.user.id,
      due_date: emDias(20),
    });
    expect(res.status).toBe(400);
    expect(res.body.limit_days).toBe(7);
  });

  it("a prioridade escolhida não mexe no limite, para cima nem para baixo", async () => {
    const { riskId } = await riscoNoNivel("SUBSTANTIAL", "Epsilon");

    // Prioridade Baixa não compra 180 dias num risco Substancial.
    const frouxa = await abrirAcao({
      title: `Tentar afrouxar ${SUFIXO}`,
      risk_id: riskId,
      priority: "LOW",
      assignee_id: supervisor.user.id,
      due_date: emDias(120),
    });
    expect(frouxa.status).toBe(400);
    expect(frouxa.body.limit_days).toBe(30);

    /*
      E marcar Crítica — que sugere 7 dias — não corta o prazo do nível pela
      metade sem avisar: quem conhece a operação pode sinalizar urgência sem
      ser punido por isso. O limite continua sendo o do nível.
    */
    const urgente = await abrirAcao({
      title: `Marcar como urgente ${SUFIXO}`,
      risk_id: riskId,
      priority: "CRITICAL",
      assignee_id: supervisor.user.id,
      due_date: emDias(25),
    });
    expect(urgente.status, JSON.stringify(urgente.body)).toBe(201);
  });

  it("ação sem risco avaliado não ganha limite inventado", async () => {
    const res = await abrirAcao({
      title: `Sem risco ${SUFIXO}`,
      assignee_id: supervisor.user.id,
      due_date: emDias(300),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });
});

describe("prazo no passado é erro de digitação [CB-21]", () => {
  it("é recusado, e nada é gravado", async () => {
    const { riskId } = await riscoNoNivel("MODERATE", "Zeta");

    const res = await abrirAcao({
      title: `Ação com prazo de ontem ${SUFIXO}`,
      risk_id: riskId,
      assignee_id: supervisor.user.id,
      due_date: emDias(-1),
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("DEADLINE_IN_THE_PAST");

    const nenhuma = await prisma.action.findFirst({
      where: { title: `Ação com prazo de ontem ${SUFIXO}` },
    });
    expect(nenhuma).toBeNull();
  });

  it("hoje ainda vale", async () => {
    const { riskId } = await riscoNoNivel("MODERATE", "Eta");
    const res = await abrirAcao({
      title: `Para hoje ${SUFIXO}`,
      risk_id: riskId,
      assignee_id: supervisor.user.id,
      due_date: emDias(0),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });
});

describe("validar a ação pede a reavaliação do risco [S3-N] [CB-20]", () => {
  it("o risco volta a pedir avaliação depois da medida instalada", async () => {
    const { riskId } = await riscoNoNivel("SUBSTANTIAL", "Teta");

    const criada = await abrirAcao({
      title: `Instalar proteção ${SUFIXO}`,
      risk_id: riskId,
      priority: "HIGH",
      assignee_id: supervisor.user.id,
      due_date: emDias(10),
    });
    expect(criada.status).toBe(201);
    const acaoId = criada.body.action.id as string;

    await request(app)
      .post("/api/evidences")
      .set(as(supervisor.token))
      .send({
        action_id: acaoId,
        file_name: "foto.png",
        mime_type: "image/png",
        content_base64: Buffer.from(`prova ${SUFIXO}`).toString("base64"),
      });
    await request(app).post(`/api/actions/${acaoId}/complete`).set(as(supervisor.token));

    const antes = await prisma.risk.findFirstOrThrow({
      where: { id: riskId },
      select: { needsReassessment: true },
    });
    expect(antes.needsReassessment).toBe(false);

    const aprovou = await request(app)
      .post(`/api/actions/${acaoId}/review`)
      .set(as(sst.token))
      .send({
        decision: "approve",
        effectiveness_result: "Proteção no lugar.",
        flag_reassessment: true,
      });
    expect(aprovou.status, JSON.stringify(aprovou.body)).toBe(200);

    const depois = await prisma.risk.findFirstOrThrow({
      where: { id: riskId },
      select: { needsReassessment: true, reassessmentReason: true },
    });
    expect(depois.needsReassessment, "o risco que sobra pode ser outro").toBe(true);
    expect(depois.reassessmentReason).toBeTruthy();
  });
});

describe("quem pode ser responsável [CB-23]", () => {
  /*
    A pessoa é criada aqui, e não emprestada do seed: suspender alguém que
    outros arquivos de teste usam faria os dois brigarem quando a suíte roda
    em paralelo.
  */
  it("pessoa suspensa não recebe ação", async () => {
    const { riskId } = await riscoNoNivel("MODERATE", "Iota");

    const login = `suspenso.${SUFIXO}`;
    const user = await prisma.user.create({
      data: {
        login,
        email: `${login}@teste.local`,
        name: `Suspenso ${SUFIXO}`,
        passwordHash: await bcrypt.hash(SENHA, 10),
      },
    });
    await prisma.membership.create({
      data: {
        userId: user.id,
        organizationId: ORG_ID,
        role: Role.COLABORADOR,
        suspendedAt: new Date(),
        suspensionReason: "MANUAL",
      },
    });
    try {
      const res = await abrirAcao({
        title: `Para quem está fora ${SUFIXO}`,
        risk_id: riskId,
        assignee_id: user.id,
        due_date: emDias(10),
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/[Rr]espons[áa]vel/);
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });
});
