import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { itensDoCertificado, type DadosDoCertificado } from "../../../client/src/lib/certificado";

/**
 * O certificado do treinamento presencial se completa na turma. [B4-B]
 *
 * No presencial, local e qualificação de quem deu a aula vêm da TURMA. A
 * turma registrada não se editava, e "Completar para o certificado", na linha
 * do curso, não alcança esses dois itens — mas a mensagem do certificado
 * mandava completar ali. Agora a turma registrada recebe os dois, com trilha,
 * e a mensagem aponta o lugar certo.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
const CLIENTE = join(__dirname, "..", "..", "..", "client", "src");

type Sessao = { token: string; user: { id: string } };
let app: Express;
let rh: Sessao;
let colaborador: Sessao;
const treinamentos: string[] = [];
const turmas: string[] = [];

const as = (s: Sessao) => ({ Authorization: `Bearer ${s.token}` });

async function entrar(login: string): Promise<Sessao> {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as Sessao;
}

/** Curso presencial com uma turma de ontem, sem local nem qualificação. */
async function turmaIncompleta() {
  const curso = await request(app)
    .post("/api/trainings")
    .set(as(rh))
    .send({
      title: `NR-12 presencial ${SUFIXO}`,
      kind: "CLASSROOM",
      summary: "Proteções do torno; parada de emergência.",
      duration_minutes: 240,
      technical_responsible_name: "Hefler Souza",
    });
  expect(curso.status, JSON.stringify(curso.body)).toBe(201);
  const trainingId = curso.body.training.id as string;
  treinamentos.push(trainingId);

  const turma = await request(app)
    .post(`/api/trainings/${trainingId}/turmas`)
    .set(as(rh))
    .send({
      held_at: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
      instructor_name: "Marcos Lima",
      duration_minutes: 240,
      attendees: [{ user_id: colaborador.user.id, present: true }],
    });
  expect(turma.status, JSON.stringify(turma.body)).toBe(201);
  const sessao = await prisma.trainingSession.findFirstOrThrow({
    where: { trainingId },
    select: { id: true },
  });
  turmas.push(sessao.id);
  const matricula = await prisma.trainingEnrollment.findFirstOrThrow({
    where: { trainingId, userId: colaborador.user.id },
    select: { id: true },
  });
  return { trainingId, sessionId: sessao.id, enrollmentId: matricula.id };
}

beforeAll(async () => {
  app = createApp();
  rh = await entrar("teste.rh");
  colaborador = await entrar("teste.colaborador");
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({
    where: { entityId: { in: [...treinamentos, ...turmas] } },
  });
  await prisma.notification.deleteMany({
    where: { entityId: { in: [...treinamentos, ...turmas] } },
  });
  await prisma.training.deleteMany({ where: { id: { in: treinamentos } } });
});

describe("a turma registrada recebe local e qualificação [B4-B]", () => {
  it("completar a turma completa o certificado de quem esteve nela", async () => {
    const { trainingId, sessionId, enrollmentId } = await turmaIncompleta();

    const antes = await request(app).get(`/api/certificados/${enrollmentId}`).set(as(colaborador));
    expect(antes.status).toBe(200);
    expect(itensDoCertificado(antes.body.certificate).faltandoNaTurma).toEqual([
      "local",
      "qualificação de quem ministrou",
    ]);

    const res = await request(app)
      .patch(`/api/trainings/${trainingId}/turmas/${sessionId}`)
      .set(as(rh))
      .send({ location: " Sala de treinamento ", instructor_qualification: "Técnico em Segurança do Trabalho" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const depois = await request(app).get(`/api/certificados/${enrollmentId}`).set(as(colaborador));
    const itens = itensDoCertificado(depois.body.certificate);
    expect(itens.local).toBe("Sala de treinamento");
    expect(itens.ministrou.qualificacao).toBe("Técnico em Segurança do Trabalho");
    expect(itens.faltando).toEqual([]);

    const trilha = await prisma.auditEvent.findFirst({
      where: { entityId: sessionId, action: "training.session_update" },
    });
    expect(trilha?.before).toEqual({ location: null, instructorQualification: null });
    expect(trilha?.after).toEqual({
      location: "Sala de treinamento",
      instructorQualification: "Técnico em Segurança do Trabalho",
    });
  });

  it("o que não vem fica como está; vazio apaga; o que não é texto é recusado", async () => {
    const { trainingId, sessionId } = await turmaIncompleta();
    const rota = `/api/trainings/${trainingId}/turmas/${sessionId}`;
    await request(app).patch(rota).set(as(rh)).send({ location: "Sala 2", instructor_qualification: "TST" });

    expect((await request(app).patch(rota).set(as(rh)).send({ location: "Sala 3" })).status).toBe(200);
    let turma = await prisma.trainingSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect([turma.location, turma.instructorQualification]).toEqual(["Sala 3", "TST"]);

    expect((await request(app).patch(rota).set(as(rh)).send({ location: "  " })).status).toBe(200);
    turma = await prisma.trainingSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(turma.location).toBeNull();

    expect((await request(app).patch(rota).set(as(rh)).send({ location: 42 })).status).toBe(400);
  });

  it("quem só faz o treinamento não mexe na turma, e turma de outro curso não se acha", async () => {
    const a = await turmaIncompleta();
    const b = await turmaIncompleta();
    const doColaborador = await request(app)
      .patch(`/api/trainings/${a.trainingId}/turmas/${a.sessionId}`)
      .set(as(colaborador))
      .send({ location: "Qualquer" });
    expect(doColaborador.status).toBe(403);

    const cruzada = await request(app)
      .patch(`/api/trainings/${a.trainingId}/turmas/${b.sessionId}`)
      .set(as(rh))
      .send({ location: "Qualquer" });
    expect(cruzada.status).toBe(404);
    const intocada = await prisma.trainingSession.findUniqueOrThrow({ where: { id: b.sessionId } });
    expect(intocada.location).toBeNull();
  });
});

describe("a mensagem do certificado aponta onde se completa [B4-B]", () => {
  const presencial: DadosDoCertificado = {
    completed_at: "2026-10-20T15:00:00.000Z",
    training: {
      kind: "CLASSROOM",
      summary: null,
      instructor_name: "Daniel Ferreira",
      instructor_qualification: "TST",
      technical_responsible_name: null,
      technical_responsible_qualification: null,
    },
    session: {
      held_at: "2026-10-20T00:00:00.000Z",
      location: null,
      instructor_name: "Marcos Lima",
      instructor_registration: null,
      instructor_qualification: null,
    },
  };

  it("no presencial, local e qualificação ficam com a turma; o resto com o curso", () => {
    const itens = itensDoCertificado(presencial);
    expect(itens.faltando).toEqual([
      "conteúdo programático",
      "local",
      "qualificação de quem ministrou",
      "responsável técnico",
    ]);
    expect(itens.faltandoNaTurma).toEqual(["local", "qualificação de quem ministrou"]);
  });

  it("no curso a distância nada fica com a turma", () => {
    const itens = itensDoCertificado({
      ...presencial,
      training: { ...presencial.training, kind: "ONLINE", instructor_qualification: null },
      session: null,
    });
    expect(itens.faltando).toContain("qualificação de quem ministrou");
    expect(itens.faltandoNaTurma).toEqual([]);
  });

  it("a tela separa as duas mensagens e manda cada item ao seu lugar", () => {
    const tela = readFileSync(join(CLIENTE, "pages", "CertificatePage.tsx"), "utf8")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
      .replace(/\s+/g, " ");
    expect(tela).toContain(
      "const noCurso = itens.faltando.filter((item) => !itens.faltandoNaTurma.includes(item));",
    );
    expect(tela).toContain("Falta no cadastro do treinamento: {noCurso.join(\", \")}.");
    expect(tela).toContain("{itens.faltandoNaTurma.join(\", \")}");
    expect(tela).toContain("em \"Turmas presenciais\", na própria turma.");
    expect(tela).not.toContain("Falta no cadastro do treinamento: {itens.faltando.join");
  });
});
