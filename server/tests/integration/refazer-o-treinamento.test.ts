import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Refazer o treinamento concluído, sem perder o certificado.
 *
 * O aviso do certificado abaixo da nota mínima mandava refazer, e não havia
 * botão [CB-65]. Pelo servidor, refazer rebaixava a inscrição a "em
 * andamento" ao começar e, se a nova prova não passasse, apagava o
 * certificado — que pela decisão vale até vencer [CB-31]. Agora o concluído
 * abaixo da nota, ou vencido, pode ser refeito, e só um certificado novo
 * substitui o antigo.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const CONTA_ID = "aaaaaaaa-0001-4000-8000-000000000002";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
const PAGINAS = join(__dirname, "..", "..", "..", "client", "src", "pages");

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rhId = "";
const criados: string[] = [];
const treinamentos: string[] = [];

async function pessoa(nome: string) {
  const login = `refaz.${nome}.${SUFIXO}`;
  const user = await prisma.user.create({
    data: {
      login,
      email: `${login}@teste.local`,
      name: `Aluno ${nome} ${SUFIXO}`,
      passwordHash: await bcrypt.hash(SENHA, 4),
      mustChangePassword: false,
    },
  });
  criados.push(user.id);
  await prisma.membership.create({ data: { userId: user.id, organizationId: ORG_ID, role: Role.COLABORADOR } });
  await prisma.accountMembership.create({ data: { accountId: CONTA_ID, userId: user.id, role: "USER" } });
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return { userId: user.id, token: res.body.token as string };
}

/** Curso a distância com uma pergunta (a certa é a 1), nota mínima 70 e validade. */
async function curso(titulo: string) {
  const t = await prisma.training.create({
    data: {
      organizationId: ORG_ID,
      title: `${titulo} ${SUFIXO}`,
      kind: "ONLINE",
      summary: "Conteúdo de teste.",
      durationMinutes: 30,
      passingScore: 70,
      validityMonths: 12,
      createdById: rhId,
    },
  });
  treinamentos.push(t.id);
  const q = await prisma.trainingQuestion.create({
    data: { trainingId: t.id, order: 1, prompt: "Qual?", options: ["errada", "certa"], correctIndex: 1 },
  });
  return { id: t.id, perguntaId: q.id };
}

async function concluido(trainingId: string, userId: string, dados: { score: number; expiresAt: Date | null }) {
  return prisma.trainingEnrollment.create({
    data: {
      trainingId,
      userId,
      status: "COMPLETED",
      score: dados.score,
      completedAt: new Date("2025-06-01T12:00:00.000Z"),
      certificateCode: `TR-${SUFIXO.toUpperCase()}-${Math.random().toString(36).slice(2, 6)}`,
      expiresAt: dados.expiresAt,
    },
  });
}

const minha = async (trainingId: string, token: string) =>
  (await request(app).get(`/api/trainings/${trainingId}`).set(as(token))).body.training.my_enrollment;

const entregar = (c: { id: string; perguntaId: string }, token: string, indice: number) =>
  request(app)
    .post(`/api/trainings/${c.id}/complete`)
    .set(as(token))
    .send({ answers: [{ question_id: c.perguntaId, index: indice }] });

const doBanco = (id: string) =>
  prisma.trainingEnrollment.findUniqueOrThrow({
    where: { id },
    select: { status: true, certificateCode: true, score: true, expiresAt: true },
  });

beforeAll(async () => {
  app = createApp();
  const rh = await request(app).post("/api/auth").send({ login: "teste.rh", password: SENHA });
  rhId = rh.body.user.id;
});

afterAll(async () => {
  await prisma.training.deleteMany({ where: { id: { in: treinamentos } } });
  await prisma.user.deleteMany({ where: { id: { in: criados } } });
});

describe("quem pode refazer [CB-65]", () => {
  it("concluído abaixo da nota de hoje: pode", async () => {
    const c = await curso("Abaixo");
    const p = await pessoa("abaixo");
    await concluido(c.id, p.userId, { score: 0, expiresAt: new Date(Date.now() + 200 * 86_400_000) });
    expect((await minha(c.id, p.token)).can_retake).toBe(true);
  });

  it("concluído e vencido: pode", async () => {
    const c = await curso("Vencido");
    const p = await pessoa("vencido");
    await concluido(c.id, p.userId, { score: 100, expiresAt: new Date(Date.now() - 86_400_000) });
    expect((await minha(c.id, p.token)).can_retake).toBe(true);
  });

  it("concluído, acima da nota e válido: não pode, e o servidor continua recusando", async () => {
    const c = await curso("Em dia");
    const p = await pessoa("emdia");
    const m = await concluido(c.id, p.userId, { score: 100, expiresAt: new Date(Date.now() + 200 * 86_400_000) });
    expect((await minha(c.id, p.token)).can_retake).toBe(false);
    const res = await entregar(c, p.token, 1);
    expect(res.status).toBe(409);
    expect((await doBanco(m.id)).status).toBe("COMPLETED");
  });
});

describe("refazer não apaga o certificado que vale [CB-31] [CB-65]", () => {
  it("começar de novo não rebaixa a inscrição", async () => {
    const c = await curso("Começar");
    const p = await pessoa("comecar");
    const m = await concluido(c.id, p.userId, { score: 0, expiresAt: new Date(Date.now() + 200 * 86_400_000) });
    const res = await request(app).post(`/api/trainings/${c.id}/start`).set(as(p.token));
    expect(res.status).toBe(200);
    const depois = await doBanco(m.id);
    expect(depois.status).toBe("COMPLETED");
    expect(depois.certificateCode).toBe(m.certificateCode);
  });

  it("não passar na prova nova mantém o certificado, e a tela diz que ele continua valendo", async () => {
    const c = await curso("Não passa");
    const p = await pessoa("naopassa");
    const m = await concluido(c.id, p.userId, { score: 0, expiresAt: new Date(Date.now() + 200 * 86_400_000) });
    const res = await entregar(c, p.token, 0);
    expect(res.status).toBe(200);
    expect(res.body.passed).toBe(false);
    expect(res.body.message).toMatch(/continua valendo até vencer/);
    const depois = await doBanco(m.id);
    expect(depois).toMatchObject({ status: "COMPLETED", certificateCode: m.certificateCode, score: 0 });
  });

  it("passar dá um certificado novo, com a nota e a validade novas", async () => {
    const c = await curso("Passa");
    const p = await pessoa("passa");
    const m = await concluido(c.id, p.userId, { score: 100, expiresAt: new Date(Date.now() - 86_400_000) });
    const res = await entregar(c, p.token, 1);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.passed).toBe(true);
    const depois = await doBanco(m.id);
    expect(depois.status).toBe("COMPLETED");
    expect(depois.certificateCode).not.toBe(m.certificateCode);
    expect(depois.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("quem ainda não concluiu continua como antes: começa em andamento, e reprovar marca não passou", async () => {
    const c = await curso("Primeira vez");
    const p = await pessoa("primeira");
    const comecou = await request(app).post(`/api/trainings/${c.id}/start`).set(as(p.token));
    expect(comecou.body.enrollment.status).toBe("IN_PROGRESS");
    const res = await entregar(c, p.token, 0);
    expect(res.body.passed).toBe(false);
    expect((await doBanco(comecou.body.enrollment.id)).status).toBe("FAILED");
  });
});

describe("a tela [CB-65]", () => {
  const tela = readFileSync(join(PAGINAS, "TrainingPage.tsx"), "utf8").replace(/\s+/g, " ");

  it("o concluído que pode ser refeito tem o botão", () => {
    expect(tela).toMatch(
      /\{matricula\.can_retake && !soConsulta && !presencial && !refazendo && \( <div className="form-actions"> <Button type="button" onClick=\{\(\) => \{ setRefazendo\(true\); void comecar\(\); \}\} > Refazer o treinamento <\/Button>/,
    );
  });

  it("refazendo, o conteúdo e a prova aparecem mesmo com o curso concluído", () => {
    expect(tela).toContain("const emCurso = !concluido || refazendo;");
    expect(tela).toContain("{!presencial && emCurso && passo > 0 && !naProva && (");
    expect(tela).toContain("{!presencial && emCurso && naProva && (");
    expect(tela).toContain("if (res.passed) setRefazendo(false);");
  });

  it("o certificado vencido diz que venceu", () => {
    expect(tela).toMatch(/Este certificado venceu em \{formatDay\(matricula\.expiresAt\)\}/);
  });
});
