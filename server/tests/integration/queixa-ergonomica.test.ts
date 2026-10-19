import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * A queixa ergonômica de quem faz o trabalho.
 *
 * Para o colaborador, a Avaliação ergonômica era uma lista sem nenhum botão
 * — e, mesmo assim, pela rota ele conseguia abrir uma avaliação. Agora a
 * avaliação é do SST e a queixa é dele. [P1]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let colaborador: { token: string; user: { id: string } };
let sst: { token: string; user: { id: string } };
let supervisor: { token: string; user: { id: string } };
let unidade = "";
const queixas: string[] = [];
const aeps: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

async function registrar(token: string, descricao: string, onde?: string) {
  const res = await request(app)
    .post("/api/queixas-ergonomicas")
    .set(as(token))
    .send({ description: descricao, ...(onde ? { body_part: onde } : {}) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  queixas.push(res.body.complaint.id);
  return res.body.complaint as { id: string; status: string; jobRoleName: string | null };
}

beforeAll(async () => {
  app = createApp();
  colaborador = await entrar("teste.colaborador");
  sst = await entrar("teste.sst");
  supervisor = await entrar("teste.supervisor");

  /*
    A unidade do colaborador, não "a primeira da empresa": o banco local
    acumula unidades de outros testes, e a queixa grava a unidade da função
    de quem registra.
  */
  const ficha = await prisma.employeeProfile.findFirst({
    where: { organizationId: ORG_ID, userId: colaborador.user.id },
    select: {
      jobRole: { select: { sector: { select: { establishmentId: true } } } },
    },
  });
  unidade = ficha?.jobRole?.sector.establishmentId ?? "";
  expect(unidade, "a unidade do colaborador do seed").toBeTruthy();
});

afterAll(async () => {
  await prisma.notification.deleteMany({
    where: { entityType: "ErgonomicComplaint", entityId: { in: queixas } },
  });
  await prisma.ergonomicComplaint.deleteMany({ where: { id: { in: queixas } } });
  await prisma.aep.deleteMany({ where: { id: { in: aeps } } });
});

describe("a avaliação é do SST [P1]", () => {
  it("o colaborador não abre mais uma avaliação pela rota", async () => {
    const res = await request(app)
      .post("/api/aeps")
      .set(as(colaborador.token))
      .send({
        establishment_id: unidade,
        scope_description: `Tentativa do colaborador ${SUFIXO}`,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it("nem edita a avaliação que ele mesmo abriu antes desta mudança", async () => {
    /*
      Editar a avaliação de OUTRA pessoa já era recusado. O que muda é a
      própria: quem abriu uma avaliação enquanto a rota aceitava escrita
      também deixa de editá-la.
    */
    const minha = await prisma.aep.create({
      data: {
        organizationId: ORG_ID,
        establishmentId: unidade,
        scopeDescription: `Avaliação aberta pelo colaborador ${SUFIXO}`,
        conductedById: colaborador.user.id,
      },
      select: { id: true },
    });
    aeps.push(minha.id);
    const res = await request(app)
      .patch(`/api/aeps/${minha.id}`)
      .set(as(colaborador.token))
      .send({ findings: "editado por quem não devia" });
    expect(res.status, JSON.stringify(res.body)).toBe(403);

    const depois = await prisma.aep.findUnique({
      where: { id: minha.id },
      select: { findings: true },
    });
    expect(depois?.findings).toBeNull();
  });

  it("o SST continua abrindo normalmente", async () => {
    const res = await request(app)
      .post("/api/aeps")
      .set(as(sst.token))
      .send({
        establishment_id: unidade,
        scope_description: `Avaliação do SST pela rota ${SUFIXO}`,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    aeps.push(res.body.aep.id);
  });
});

describe("a queixa é de quem trabalha [P1]", () => {
  it("o colaborador registra, e a função e a unidade ficam gravadas", async () => {
    const q = await registrar(
      colaborador.token,
      `Dói o ombro ao abastecer a prateleira de cima ${SUFIXO}`,
      "Ombro direito",
    );
    expect(q.status).toBe("OPEN");
    // A ficha do seed liga o colaborador a uma função, e a função a uma unidade.
    expect(q.jobRoleName).toBeTruthy();

    const gravada = await prisma.ergonomicComplaint.findUnique({
      where: { id: q.id },
      select: { establishmentId: true, bodyPart: true, userId: true },
    });
    expect(gravada?.establishmentId).toBe(unidade);
    expect(gravada?.bodyPart).toBe("Ombro direito");
    expect(gravada?.userId).toBe(colaborador.user.id);
  });

  it("queixa sem texto é recusada", async () => {
    const res = await request(app)
      .post("/api/queixas-ergonomicas")
      .set(as(colaborador.token))
      .send({ body_part: "Lombar" });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  it("quem cuida do módulo é avisado; quem não cuida, não", async () => {
    const q = await registrar(colaborador.token, `Dor na lombar ${SUFIXO}`);
    const avisados = await prisma.notification.findMany({
      where: { entityType: "ErgonomicComplaint", entityId: q.id },
      select: { userId: true, kind: true },
    });
    const quem = avisados.map((a) => a.userId);
    expect(quem).toContain(sst.user.id);
    expect(quem).not.toContain(colaborador.user.id);
    expect(avisados[0]?.kind).toBe("ERGONOMIC_COMPLAINT_OPENED");
  });

  it("a queixa de dor não é pública: cada um vê a sua", async () => {
    const minha = await registrar(colaborador.token, `Só minha ${SUFIXO}`);

    const doSupervisor = await request(app)
      .get("/api/queixas-ergonomicas")
      .set(as(supervisor.token));
    expect(doSupervisor.status, JSON.stringify(doSupervisor.body)).toBe(200);
    expect(doSupervisor.body.manages).toBe(false);
    expect(
      doSupervisor.body.complaints.map((q: { id: string }) => q.id),
    ).not.toContain(minha.id);

    const doColaborador = await request(app)
      .get("/api/queixas-ergonomicas")
      .set(as(colaborador.token));
    expect(doColaborador.body.manages).toBe(false);
    expect(
      doColaborador.body.complaints.map((q: { id: string }) => q.id),
    ).toContain(minha.id);

    const doSst = await request(app)
      .get("/api/queixas-ergonomicas")
      .set(as(sst.token));
    expect(doSst.body.manages).toBe(true);
    expect(doSst.body.complaints.map((q: { id: string }) => q.id)).toContain(minha.id);
  });
});

describe("transformar em avaliação, ou responder [P1]", () => {
  it("quem não cuida do módulo não responde queixa de ninguém", async () => {
    const q = await registrar(colaborador.token, `Para o supervisor tentar ${SUFIXO}`);
    for (const quem of [colaborador, supervisor]) {
      const res = await request(app)
        .post(`/api/queixas-ergonomicas/${q.id}/avaliacao`)
        .set(as(quem.token))
        .send({ establishment_id: unidade, scope_description: "x" });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    }
  });

  it("o SST transforma a queixa em avaliação, e quem registrou é avisado", async () => {
    const q = await registrar(colaborador.token, `Vira avaliação ${SUFIXO}`);
    const res = await request(app)
      .post(`/api/queixas-ergonomicas/${q.id}/avaliacao`)
      .set(as(sst.token))
      .send({
        establishment_id: unidade,
        scope_description: `Abastecimento da prateleira alta ${SUFIXO}`,
        note: "Vamos avaliar o posto nesta semana.",
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    aeps.push(res.body.aep_id);

    const depois = await prisma.ergonomicComplaint.findUnique({
      where: { id: q.id },
      select: { status: true, aepId: true, handledById: true, handlingNote: true },
    });
    expect(depois?.status).toBe("IN_EVALUATION");
    expect(depois?.aepId).toBe(res.body.aep_id);
    expect(depois?.handledById).toBe(sst.user.id);

    // A avaliação nasce com o que a pessoa escreveu, para não se perder.
    const aep = await prisma.aep.findUnique({
      where: { id: res.body.aep_id },
      select: { findings: true, establishmentId: true },
    });
    expect(aep?.findings).toContain(`Vira avaliação ${SUFIXO}`);
    expect(aep?.establishmentId).toBe(unidade);

    const aviso = await prisma.notification.findFirst({
      where: {
        entityType: "ErgonomicComplaint",
        entityId: q.id,
        kind: "ERGONOMIC_COMPLAINT_HANDLED",
      },
      select: { userId: true, body: true },
    });
    expect(aviso?.userId).toBe(colaborador.user.id);
    expect(aviso?.body).toBe("Vamos avaliar o posto nesta semana.");
  });

  it("encerrar sem avaliação exige motivo, e o motivo é o que a pessoa lê", async () => {
    const q = await registrar(colaborador.token, `Encerrada ${SUFIXO}`);

    const semMotivo = await request(app)
      .post(`/api/queixas-ergonomicas/${q.id}/encerramento`)
      .set(as(sst.token))
      .send({});
    expect(semMotivo.status, JSON.stringify(semMotivo.body)).toBe(400);

    const motivo = `Já existe avaliação do mesmo posto de ${SUFIXO}.`;
    const res = await request(app)
      .post(`/api/queixas-ergonomicas/${q.id}/encerramento`)
      .set(as(sst.token))
      .send({ note: motivo });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const doColaborador = await request(app)
      .get("/api/queixas-ergonomicas")
      .set(as(colaborador.token));
    const minha = doColaborador.body.complaints.find(
      (c: { id: string }) => c.id === q.id,
    );
    expect(minha.status).toBe("CLOSED");
    expect(minha.handlingNote).toBe(motivo);
    expect(minha.handledBy.id).toBe(sst.user.id);

    const aviso = await prisma.notification.findFirst({
      where: {
        entityType: "ErgonomicComplaint",
        entityId: q.id,
        kind: "ERGONOMIC_COMPLAINT_HANDLED",
      },
      select: { userId: true, body: true },
    });
    expect(aviso?.userId).toBe(colaborador.user.id);
    expect(aviso?.body).toBe(motivo);
  });

  it("queixa já respondida não é respondida de novo", async () => {
    const q = await registrar(colaborador.token, `Resposta dupla ${SUFIXO}`);
    const uma = await request(app)
      .post(`/api/queixas-ergonomicas/${q.id}/encerramento`)
      .set(as(sst.token))
      .send({ note: "Primeira resposta." });
    expect(uma.status).toBe(200);

    const outra = await request(app)
      .post(`/api/queixas-ergonomicas/${q.id}/avaliacao`)
      .set(as(sst.token))
      .send({ establishment_id: unidade, scope_description: "tarde demais" });
    expect(outra.status, JSON.stringify(outra.body)).toBe(409);
    expect(outra.body.code).toBe("ALREADY_HANDLED");

    const depois = await prisma.ergonomicComplaint.findUnique({
      where: { id: q.id },
      select: { status: true, handlingNote: true },
    });
    expect(depois?.status).toBe("CLOSED");
    expect(depois?.handlingNote).toBe("Primeira resposta.");
  });

  it("unidade de outra empresa é recusada", async () => {
    const q = await registrar(colaborador.token, `Unidade inválida ${SUFIXO}`);
    const res = await request(app)
      .post(`/api/queixas-ergonomicas/${q.id}/avaliacao`)
      .set(as(sst.token))
      .send({
        establishment_id: "00000000-0000-4000-8000-00000000dead",
        scope_description: "x",
      });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });
});
