import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * A turma pode ser marcada antes de acontecer.
 *
 * A turma só existia depois da aula: não havia como agendar nem convocar
 * ninguém, e a lista de presença entrava junto com o registro. Agora data no
 * futuro é agendamento, quem é convocado recebe o aviso, e a presença entra
 * depois — que é o que gera o certificado. [CB-34]
 *
 * E o treinamento passa a ser cadastrável pela tela, com nota mínima. [CB-30]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: { token: string; user: { id: string } };
const criados: string[] = [];
const treinamentos: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

async function aluno(nome: string) {
  const login = `turma.${nome}.${SUFIXO}`;
  const user = await prisma.user.create({
    data: {
      login,
      email: `${login}@teste.local`,
      name: `Aluno ${nome} ${SUFIXO}`,
      passwordHash: await bcrypt.hash(SENHA, 10),
      mustChangePassword: false,
    },
  });
  criados.push(user.id);
  await prisma.membership.create({
    data: { userId: user.id, organizationId: ORG_ID, role: Role.COLABORADOR },
  });
  await prisma.accountMembership.create({
    data: {
      accountId: "aaaaaaaa-0001-4000-8000-000000000002",
      userId: user.id,
      role: "USER",
    },
  });
  return user.id;
}

function emDias(dias: number): string {
  return new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);
}

/** Cria um treinamento presencial pela API que a tela usa. [CB-30] */
async function presencial(titulo: string, passingScore = 70) {
  const res = await request(app)
    .post("/api/trainings")
    .set(as(rh.token))
    .send({
      title: `${titulo} ${SUFIXO}`,
      kind: "CLASSROOM",
      summary: "Conteúdo do treinamento presencial.",
      duration_minutes: 120,
      passing_score: passingScore,
      validity_months: 24,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  treinamentos.push(res.body.training.id);
  return res.body.training.id as string;
}

beforeAll(async () => {
  app = createApp();
  rh = await entrar("teste.rh");
});

afterAll(async () => {
  await prisma.training.deleteMany({ where: { id: { in: treinamentos } } });
  await prisma.user.deleteMany({ where: { id: { in: criados } } });
});

describe("cadastrar treinamento pela tela [CB-30]", () => {
  it("título, tipo, conteúdo, carga horária e nota mínima entram pela API da tela", async () => {
    const res = await request(app)
      .post("/api/trainings")
      .set(as(rh.token))
      .send({
        title: `NR-35 Altura ${SUFIXO}`,
        kind: "CLASSROOM",
        summary: "Trabalho em altura: cinto, ancoragem e resgate.",
        duration_minutes: 480,
        passing_score: 85,
        validity_months: 24,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    treinamentos.push(res.body.training.id);

    const guardado = await prisma.training.findFirstOrThrow({
      where: { id: res.body.training.id },
      select: { kind: true, passingScore: true, durationMinutes: true, validityMonths: true },
    });
    expect(guardado.kind).toBe("CLASSROOM");
    expect(guardado.passingScore, "a nota mínima não se mudava por tela nenhuma").toBe(85);
    expect(guardado.durationMinutes).toBe(480);
    expect(guardado.validityMonths).toBe(24);
  });

  it("o treinamento a distância aceita prova com a resposta certa", async () => {
    const res = await request(app)
      .post("/api/trainings")
      .set(as(rh.token))
      .send({
        title: `Com prova ${SUFIXO}`,
        kind: "ONLINE",
        passing_score: 70,
        questions: [
          {
            prompt: "Quando usar o cinto?",
            options: ["Nunca", "Acima de 2 metros"],
            correct_index: 1,
          },
        ],
      });
    expect(res.status).toBe(201);
    treinamentos.push(res.body.training.id);

    const perguntas = await prisma.trainingQuestion.findMany({
      where: { trainingId: res.body.training.id },
      select: { correctIndex: true },
    });
    expect(perguntas.length).toBe(1);
    expect(perguntas[0]!.correctIndex).toBe(1);
  });
});

describe("marcar a turma antes da aula [CB-34]", () => {
  it("data no futuro agenda, convoca e avisa — sem lista de presença", async () => {
    const t = await presencial("Marcada");
    const a = await aluno("um");
    const b = await aluno("dois");

    const res = await request(app)
      .post(`/api/trainings/${t}/turmas`)
      .set(as(rh.token))
      .send({
        held_at: emDias(7),
        instructor_name: "Instrutor Teste",
        location: "Sala 2",
        duration_minutes: 120,
        invite_user_ids: [a, b],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const turma = await prisma.trainingSession.findFirstOrThrow({
      where: { trainingId: t },
      include: { attendances: true },
    });
    expect(turma.attendances.length, "turma marcada não tem presença").toBe(0);

    // A convocação existe, e cada pessoa foi avisada.
    /*
      O título leva o sufixo desta execução: buscar só por "Marcada" casava
      com a convocação de uma execução anterior.
    */
    const convocacao = await prisma.summon.findFirst({
      where: { organizationId: ORG_ID, title: `Treinamento: Marcada ${SUFIXO}` },
      include: { attendances: true },
    });
    expect(convocacao?.attendances.length).toBe(2);

    const avisos = await prisma.notification.findMany({
      where: { userId: { in: [a, b] }, kind: "TRAINING_SCHEDULED" },
    });
    expect(avisos.length, "quem foi chamado fica sabendo").toBe(2);
  });

  it("marcar com lista de presença é recusado: a aula ainda não aconteceu", async () => {
    const t = await presencial("Com lista");
    const a = await aluno("tres");

    const res = await request(app)
      .post(`/api/trainings/${t}/turmas`)
      .set(as(rh.token))
      .send({
        held_at: emDias(5),
        instructor_name: "Instrutor Teste",
        attendees: [{ user_id: a, present: true }],
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SESSION_NOT_HELD_YET");
  });

  it("registrar turma que já aconteceu continua exigindo quem esteve", async () => {
    const t = await presencial("Sem ninguém");
    const res = await request(app)
      .post(`/api/trainings/${t}/turmas`)
      .set(as(rh.token))
      .send({ held_at: emDias(-1), instructor_name: "Instrutor Teste" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/quem esteve/i);
  });
});

describe("a presença entra depois da aula [CB-34]", () => {
  it("lançar a presença conclui e gera o certificado", async () => {
    const t = await presencial("Depois da aula");
    const a = await aluno("quatro");

    const marcada = await request(app)
      .post(`/api/trainings/${t}/turmas`)
      .set(as(rh.token))
      .send({
        held_at: emDias(3),
        instructor_name: "Instrutor Teste",
        invite_user_ids: [a],
      });
    expect(marcada.status).toBe(201);
    const sessionId = marcada.body.session.id as string;

    // A aula ainda não aconteceu: a presença é recusada.
    const cedo = await request(app)
      .post(`/api/trainings/${t}/turmas/${sessionId}/presenca`)
      .set(as(rh.token))
      .send({ attendees: [{ user_id: a, present: true }] });
    expect(cedo.status).toBe(409);
    expect(cedo.body.code).toBe("SESSION_NOT_HELD_YET");

    // O dia chega.
    await prisma.trainingSession.update({
      where: { id: sessionId },
      data: { heldAt: new Date(Date.now() - 86_400_000) },
    });

    const lancou = await request(app)
      .post(`/api/trainings/${t}/turmas/${sessionId}/presenca`)
      .set(as(rh.token))
      .send({ attendees: [{ user_id: a, present: true }] });
    expect(lancou.status, JSON.stringify(lancou.body)).toBe(200);

    const matricula = await prisma.trainingEnrollment.findFirstOrThrow({
      where: { trainingId: t, userId: a },
      select: { status: true, certificateCode: true, expiresAt: true },
    });
    expect(matricula.status).toBe("COMPLETED");
    expect(matricula.certificateCode, "a presença é que gera o certificado").toBeTruthy();
    expect(matricula.expiresAt).toBeTruthy();
  });

  it("não dá para lançar a presença duas vezes", async () => {
    const t = await presencial("Duas vezes");
    const a = await aluno("cinco");
    const marcada = await request(app)
      .post(`/api/trainings/${t}/turmas`)
      .set(as(rh.token))
      .send({ held_at: emDias(2), instructor_name: "Instrutor Teste" });
    const sessionId = marcada.body.session.id as string;
    await prisma.trainingSession.update({
      where: { id: sessionId },
      data: { heldAt: new Date(Date.now() - 86_400_000) },
    });

    const primeira = await request(app)
      .post(`/api/trainings/${t}/turmas/${sessionId}/presenca`)
      .set(as(rh.token))
      .send({ attendees: [{ user_id: a, present: true }] });
    expect(primeira.status).toBe(200);

    const segunda = await request(app)
      .post(`/api/trainings/${t}/turmas/${sessionId}/presenca`)
      .set(as(rh.token))
      .send({ attendees: [{ user_id: a, present: true }] });
    expect(segunda.status).toBe(409);
    expect(segunda.body.code).toBe("ATTENDANCE_ALREADY_RECORDED");
  });
});
