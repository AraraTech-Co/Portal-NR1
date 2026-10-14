import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";

/**
 * Fazer o curso a distância de ponta a ponta [S4-C], registrar a turma
 * presencial com instrutor e lista de presença [S4-D], e a nota mínima que
 * separa certificado de comprovante de presença [S4-K].
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

async function entrar(app: Express, login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: { token: string; user: { id: string } };
let colaborador: { token: string; user: { id: string } };
let supervisor: { token: string; user: { id: string } };
let fiscal: { token: string; user: { id: string } };

beforeAll(async () => {
  app = createApp();
  rh = await entrar(app, "teste.rh");
  colaborador = await entrar(app, "teste.colaborador");
  supervisor = await entrar(app, "teste.supervisor");
  fiscal = await entrar(app, "teste.fiscal");
});

/** Curso com duas perguntas: acertar uma dá 50%. */
async function novoCurso(nome: string, extra: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/trainings")
    .set(as(rh.token))
    .send({
      title: `${nome} ${SUFIXO}`,
      validity_months: 12,
      slides: [
        { title: "Antes de começar", body: "Leia com atenção." },
        { title: "Na prática", body: "Use o equipamento de proteção." },
      ],
      questions: [
        {
          prompt: "Pode operar sem proteção?",
          options: ["Nunca", "Se for rápido"],
          correct_index: 0,
        },
        {
          prompt: "Quem avisar se o equipamento falhar?",
          options: ["Ninguém", "O supervisor"],
          correct_index: 1,
        },
      ],
      ...extra,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.training as { id: string };
}

/** Como a tela faz: entra no curso e depois entrega a prova. */
async function responder(
  token: string,
  trainingId: string,
  answers: { question_id: string; index: number }[],
) {
  await request(app).post(`/api/trainings/${trainingId}/start`).set(as(token));
  return request(app)
    .post(`/api/trainings/${trainingId}/complete`)
    .set(as(token))
    .send({ answers });
}

async function perguntas(token: string, trainingId: string) {
  const res = await request(app).get(`/api/trainings/${trainingId}`).set(as(token));
  expect(res.status).toBe(200);
  return res.body.training as {
    kind: string;
    passingScore: number;
    slides: unknown[];
    questions: { id: string; options: string[]; correctIndex?: number }[];
    my_enrollment: { status: string; score: number | null } | null;
  };
}

describe("o curso a distância acontece de verdade [S4-C]", () => {
  it("o colaborador abre o conteúdo, responde e sai com certificado", async () => {
    const curso = await novoCurso("Proteção de máquina");

    const antes = await perguntas(colaborador.token, curso.id);
    expect(antes.slides).toHaveLength(2);
    expect(antes.questions).toHaveLength(2);
    // Gabarito não vai para quem vai fazer a prova.
    expect(antes.questions[0]!.correctIndex).toBeUndefined();
    expect(antes.my_enrollment).toBeNull();

    const inicio = await request(app)
      .post(`/api/trainings/${curso.id}/start`)
      .set(as(colaborador.token));
    expect(inicio.status).toBe(200);
    expect(inicio.body.enrollment.status).toBe("IN_PROGRESS");

    const res = await responder(colaborador.token, curso.id, [
      { question_id: antes.questions[0]!.id, index: 0 },
      { question_id: antes.questions[1]!.id, index: 1 },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.passed).toBe(true);
    expect(res.body.enrollment.score).toBe(100);
    expect(res.body.enrollment.status).toBe("COMPLETED");
    expect(res.body.enrollment.certificateCode).toBeTruthy();
    expect(res.body.enrollment.expiresAt).toBeTruthy();

    // Quem cuida dos treinamentos e a fiscalização veem o certificado.
    for (const token of [rh.token, fiscal.token]) {
      const lista = await request(app)
        .get(`/api/trainings/${curso.id}/enrollments`)
        .set(as(token));
      expect(lista.status).toBe(200);
      const minha = (lista.body.enrollments as { user: { id: string }; score: number }[]).find(
        (e) => e.user.id === colaborador.user.id,
      );
      expect(minha?.score).toBe(100);
    }
  });

  it("o gabarito vai para quem cuida do treinamento", async () => {
    const curso = await novoCurso("Gabarito");
    const visto = await perguntas(rh.token, curso.id);
    expect(visto.questions[0]!.correctIndex).toBe(0);
  });

  it("entregar sem responder tudo não passa", async () => {
    const curso = await novoCurso("Incompleta");
    const q = (await perguntas(colaborador.token, curso.id)).questions;
    const res = await responder(colaborador.token, curso.id, [
      { question_id: q[0]!.id, index: 0 },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/todas as perguntas/i);
  });
});

describe("nota mínima: certificado é prova de capacitação [S4-K]", () => {
  it("errar metade não gera certificado, e dá para refazer", async () => {
    const curso = await novoCurso("Nota mínima");
    const q = (await perguntas(colaborador.token, curso.id)).questions;

    const ruim = await responder(colaborador.token, curso.id, [
      { question_id: q[0]!.id, index: 1 },
      { question_id: q[1]!.id, index: 1 },
    ]);
    expect(ruim.status).toBe(200);
    expect(ruim.body.passed).toBe(false);
    expect(ruim.body.enrollment.score).toBe(50);
    expect(ruim.body.enrollment.status).toBe("FAILED");
    expect(ruim.body.enrollment.certificateCode).toBeNull();
    expect(ruim.body.enrollment.completedAt).toBeNull();
    expect(ruim.body.passing_score).toBe(70);
    expect(ruim.body.message).toMatch(/50%/);

    // Refazer acertando tudo gera o certificado.
    const bom = await responder(colaborador.token, curso.id, [
      { question_id: q[0]!.id, index: 0 },
      { question_id: q[1]!.id, index: 1 },
    ]);
    expect(bom.status).toBe(200);
    expect(bom.body.passed).toBe(true);
    expect(bom.body.enrollment.certificateCode).toBeTruthy();
  });

  it("a nota mínima é do treinamento e vai de 0 a 100", async () => {
    const curso = await novoCurso("Mínima 50", { passing_score: 50 });
    const q = (await perguntas(colaborador.token, curso.id)).questions;
    const res = await responder(colaborador.token, curso.id, [
      { question_id: q[0]!.id, index: 1 },
      { question_id: q[1]!.id, index: 1 },
    ]);
    expect(res.body.enrollment.score).toBe(50);
    expect(res.body.passed, "50 alcança a mínima de 50").toBe(true);

    const invalida = await request(app)
      .post("/api/trainings")
      .set(as(rh.token))
      .send({ title: `Mínima torta ${SUFIXO}`, passing_score: 120 });
    expect(invalida.status).toBe(400);
    expect(invalida.body.message).toMatch(/0 a 100/);
  });
});

describe("turma presencial deixa registro [S4-D]", () => {
  const registrar = (token: string, trainingId: string, body: Record<string, unknown>) =>
    request(app)
      .post(`/api/trainings/${trainingId}/turmas`)
      .set(as(token))
      .send(body);

  it("a turma registrada conclui quem esteve e guarda quem faltou", async () => {
    const curso = await novoCurso("Brigada presencial", { kind: "CLASSROOM" });

    const res = await registrar(rh.token, curso.id, {
      held_at: "2026-10-01",
      instructor_name: "Instrutor Externo",
      instructor_registration: "CREA 123456",
      location: "Refeitório",
      duration_minutes: 240,
      notes: "Prática com extintor.",
      attendees: [
        { user_id: colaborador.user.id, present: true },
        { user_id: supervisor.user.id, present: false },
      ],
    });
    expect(res.status).toBe(201);

    const turmas = await request(app)
      .get(`/api/trainings/${curso.id}/turmas`)
      .set(as(rh.token));
    expect(turmas.status).toBe(200);
    const turma = (turmas.body.sessions as Record<string, never>[])[0]! as unknown as {
      instructor_name: string;
      instructor_registration: string;
      duration_minutes: number;
      present: number;
      absent: number;
      recorded_by: { name: string };
      attendances: { user: { id: string }; present: boolean }[];
    };
    expect(turma.instructor_name).toBe("Instrutor Externo");
    expect(turma.instructor_registration).toBe("CREA 123456");
    expect(turma.duration_minutes).toBe(240);
    expect(turma.present).toBe(1);
    expect(turma.absent).toBe(1);
    expect(turma.recorded_by.name).toBeTruthy();

    // Quem esteve saiu com certificado; quem faltou, não.
    const lista = await request(app)
      .get(`/api/trainings/${curso.id}/enrollments`)
      .set(as(rh.token));
    const inscritos = lista.body.enrollments as {
      user: { id: string };
      status: string;
      certificateCode: string | null;
    }[];
    const presente = inscritos.find((e) => e.user.id === colaborador.user.id);
    expect(presente?.status).toBe("COMPLETED");
    expect(presente?.certificateCode).toBeTruthy();
    expect(inscritos.some((e) => e.user.id === supervisor.user.id)).toBe(false);
  });

  it("presencial não se conclui pelo botão do curso", async () => {
    const curso = await novoCurso("Só presencial", { kind: "CLASSROOM" });
    const q = (await perguntas(colaborador.token, curso.id)).questions;
    const res = await responder(colaborador.token, curso.id, [
      { question_id: q[0]!.id, index: 0 },
      { question_id: q[1]!.id, index: 1 },
    ]);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/lista de presença/i);
  });

  it("turma no futuro, sem instrutor, sem ninguém ou em curso a distância é recusada", async () => {
    const presencial = await novoCurso("Validações", { kind: "CLASSROOM" });
    const amanha = new Date(Date.now() + 36 * 3_600_000).toISOString().slice(0, 10);

    const futuro = await registrar(rh.token, presencial.id, {
      held_at: amanha,
      instructor_name: "Alguém",
      attendees: [{ user_id: colaborador.user.id, present: true }],
    });
    expect(futuro.status).toBe(400);
    expect(futuro.body.message).toMatch(/ainda não aconteceu/i);

    const semInstrutor = await registrar(rh.token, presencial.id, {
      held_at: "2026-10-01",
      attendees: [{ user_id: colaborador.user.id, present: true }],
    });
    expect(semInstrutor.status).toBe(400);
    expect(semInstrutor.body.message).toMatch(/quem deu/i);

    const semNinguem = await registrar(rh.token, presencial.id, {
      held_at: "2026-10-01",
      instructor_name: "Alguém",
      attendees: [],
    });
    expect(semNinguem.status).toBe(400);
    expect(semNinguem.body.message).toMatch(/quem esteve/i);

    const forasteiro = await registrar(rh.token, presencial.id, {
      held_at: "2026-10-01",
      instructor_name: "Alguém",
      attendees: [{ user_id: "00000000-0000-4000-8000-00000000dead", present: true }],
    });
    expect(forasteiro.status).toBe(400);
    expect(forasteiro.body.message).toMatch(/não são da empresa/i);

    const aDistancia = await novoCurso("Não é turma");
    const emCursoOnline = await registrar(rh.token, aDistancia.id, {
      held_at: "2026-10-01",
      instructor_name: "Alguém",
      attendees: [{ user_id: colaborador.user.id, present: true }],
    });
    expect(emCursoOnline.status).toBe(400);
    expect(emCursoOnline.body.message).toMatch(/presencial/i);
  });

  it("o colaborador não registra turma nem vê a lista; o fiscal vê e não registra", async () => {
    const curso = await novoCurso("Permissões da turma", { kind: "CLASSROOM" });
    await registrar(rh.token, curso.id, {
      held_at: "2026-10-01",
      instructor_name: "Instrutor",
      attendees: [{ user_id: colaborador.user.id, present: true }],
    });

    expect(
      (
        await registrar(colaborador.token, curso.id, {
          held_at: "2026-10-01",
          instructor_name: "Eu mesmo",
          attendees: [{ user_id: colaborador.user.id, present: true }],
        })
      ).status,
    ).toBe(403);
    expect(
      (await request(app).get(`/api/trainings/${curso.id}/turmas`).set(as(colaborador.token)))
        .status,
    ).toBe(403);

    const doFiscal = await request(app)
      .get(`/api/trainings/${curso.id}/turmas`)
      .set(as(fiscal.token));
    expect(doFiscal.status).toBe(200);
    expect(doFiscal.body.sessions.length).toBeGreaterThan(0);
    expect(
      (
        await registrar(fiscal.token, curso.id, {
          held_at: "2026-10-01",
          instructor_name: "Fiscal",
          attendees: [{ user_id: colaborador.user.id, present: true }],
        })
      ).status,
    ).toBe(403);
  });
});
