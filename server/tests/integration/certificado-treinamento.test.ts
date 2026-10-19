import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O certificado do treinamento vira documento.
 *
 * Era só um código na lista: nada para abrir, imprimir ou entregar à
 * fiscalização [B2-3-C]. Certificado emitido antes da nota mínima de hoje
 * vale até vencer, sai marcado e a pessoa pode refazer [CB-31]. E ninguém
 * aceita o próprio comprovante em Saúde e exigências [OB-9].
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: { token: string; user: { id: string } };
let colaborador: { token: string; user: { id: string } };
let sst: { token: string; user: { id: string } };
const criados: string[] = [];
const treinamentos: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

async function pessoa(nome: string) {
  const login = `cert.${nome}.${SUFIXO}`;
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
  await prisma.employeeProfile.create({
    data: { organizationId: ORG_ID, userId: user.id, registration: `C-${nome}${SUFIXO}`.slice(0, 20) },
  });
  return { login, userId: user.id };
}

/** Um treinamento a distância, com nota mínima e validade. */
async function treinamento(titulo: string, passingScore = 70) {
  const t = await prisma.training.create({
    data: {
      organizationId: ORG_ID,
      title: `${titulo} ${SUFIXO}`,
      kind: "ONLINE",
      summary: "Conteúdo de teste do treinamento.",
      durationMinutes: 90,
      passingScore,
      validityMonths: 12,
      createdById: rh.user.id,
    },
  });
  treinamentos.push(t.id);
  return t;
}

beforeAll(async () => {
  app = createApp();
  rh = await entrar("teste.rh");
  colaborador = await entrar("teste.colaborador");
  sst = await entrar("teste.sst");
});

afterAll(async () => {
  await prisma.training.deleteMany({ where: { id: { in: treinamentos } } });
  await prisma.user.deleteMany({ where: { id: { in: criados } } });
});

describe("o certificado é um documento [B2-3-C]", () => {
  it("traz quem fez, o quê, quando, a carga horária e a validade", async () => {
    const t = await treinamento("Uso de EPI");
    const p = await pessoa("ana");
    const matricula = await prisma.trainingEnrollment.create({
      data: {
        trainingId: t.id,
        userId: p.userId,
        status: "COMPLETED",
        score: 90,
        completedAt: new Date("2026-09-10T12:00:00.000Z"),
        certificateCode: `TR-${SUFIXO.toUpperCase()}A`,
        expiresAt: new Date("2027-09-10T12:00:00.000Z"),
      },
    });

    const sessao = await entrar(p.login);
    const res = await request(app)
      .get(`/api/certificados/${matricula.id}`)
      .set(as(sessao.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const c = res.body.certificate;
    expect(c.person.name).toContain("Aluno ana");
    expect(c.person.registration, "a matrícula vai no papel").toBeTruthy();
    expect(c.training.title).toContain("Uso de EPI");
    expect(c.training.duration_minutes).toBe(90);
    expect(c.code).toBe(matricula.certificateCode);
    expect(c.expires_at).toBeTruthy();
    expect(c.organization?.name, "o certificado é da empresa").toBeTruthy();
    expect(c.below_minimum).toBe(false);
  });

  it("quem cuida de treinamentos também abre, para entregar e mostrar", async () => {
    const t = await treinamento("Trabalho em altura");
    const p = await pessoa("bruno");
    const matricula = await prisma.trainingEnrollment.create({
      data: {
        trainingId: t.id,
        userId: p.userId,
        status: "COMPLETED",
        score: 85,
        completedAt: new Date(),
        certificateCode: `TR-${SUFIXO.toUpperCase()}B`,
      },
    });

    const doRh = await request(app)
      .get(`/api/certificados/${matricula.id}`)
      .set(as(rh.token));
    expect(doRh.status).toBe(200);

    // Quem não cuida e não é o dono, não abre o certificado alheio.
    const deOutro = await request(app)
      .get(`/api/certificados/${matricula.id}`)
      .set(as(colaborador.token));
    expect(deOutro.status).toBe(403);
  });

  it("treinamento não concluído não tem certificado", async () => {
    const t = await treinamento("Em andamento");
    const p = await pessoa("carla");
    const matricula = await prisma.trainingEnrollment.create({
      data: { trainingId: t.id, userId: p.userId, status: "IN_PROGRESS" },
    });

    const sessao = await entrar(p.login);
    const res = await request(app)
      .get(`/api/certificados/${matricula.id}`)
      .set(as(sessao.token));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NO_CERTIFICATE");
  });
});

describe("certificado abaixo da nota de hoje [CB-31]", () => {
  it("sai marcado na lista e no próprio certificado", async () => {
    const t = await treinamento("Antes da nota mínima");
    const p = await pessoa("davi");
    const matricula = await prisma.trainingEnrollment.create({
      data: {
        trainingId: t.id,
        userId: p.userId,
        status: "COMPLETED",
        score: 50,
        completedAt: new Date("2025-06-01T12:00:00.000Z"),
        certificateCode: `TR-${SUFIXO.toUpperCase()}D`,
        expiresAt: new Date("2027-06-01T12:00:00.000Z"),
      },
    });

    const lista = await request(app)
      .get(`/api/trainings/${t.id}/enrollments`)
      .set(as(rh.token));
    expect(lista.status).toBe(200);
    const linha = (lista.body.enrollments as { id: string; below_minimum: boolean }[]).find(
      (e) => e.id === matricula.id,
    );
    expect(linha?.below_minimum, "a lista não trata como igual aos outros").toBe(true);

    const sessao = await entrar(p.login);
    const cert = await request(app)
      .get(`/api/certificados/${matricula.id}`)
      .set(as(sessao.token));
    expect(cert.body.certificate.below_minimum).toBe(true);
    expect(cert.body.certificate.passing_score).toBe(70);
  });

  it("a pessoa pode refazer, em vez de ouvir que já concluiu", async () => {
    const t = await treinamento("Refazer");
    const p = await pessoa("eva");
    await prisma.trainingEnrollment.create({
      data: {
        trainingId: t.id,
        userId: p.userId,
        status: "COMPLETED",
        score: 40,
        completedAt: new Date("2025-06-01T12:00:00.000Z"),
        certificateCode: `TR-${SUFIXO.toUpperCase()}E`,
      },
    });

    const sessao = await entrar(p.login);
    const refez = await request(app)
      .post(`/api/trainings/${t.id}/complete`)
      .set(as(sessao.token))
      .send({});
    expect(refez.status, JSON.stringify(refez.body)).toBe(200);
    expect(refez.body.passed).toBe(true);

    const agora = await prisma.trainingEnrollment.findFirstOrThrow({
      where: { trainingId: t.id, userId: p.userId },
      select: { score: true },
    });
    expect(agora.score, "a nova nota substitui a antiga").toBe(100);
  });

  it("quem está acima da nota continua ouvindo que já concluiu", async () => {
    const t = await treinamento("Já passou");
    const p = await pessoa("fabio");
    await prisma.trainingEnrollment.create({
      data: {
        trainingId: t.id,
        userId: p.userId,
        status: "COMPLETED",
        score: 90,
        completedAt: new Date(),
        certificateCode: `TR-${SUFIXO.toUpperCase()}F`,
      },
    });

    const sessao = await entrar(p.login);
    const res = await request(app)
      .post(`/api/trainings/${t.id}/complete`)
      .set(as(sessao.token))
      .send({});
    expect(res.status).toBe(409);
  });
});

describe("ninguém aceita o próprio comprovante [OB-9]", () => {
  it("quem é dono do certificado não decide sobre ele", async () => {
    const exigencia = await prisma.jobRoleRequirement.findFirst({
      where: { organizationId: ORG_ID },
      select: { id: true },
    });
    const certificado = await prisma.workerCertificate.create({
      data: {
        organizationId: ORG_ID,
        userId: rh.user.id,
        requirementId: exigencia?.id ?? null,
        name: `Comprovante do próprio RH ${SUFIXO}`,
        issuedAt: new Date(),
        status: "PENDING",
      },
    });
    try {
      const proprio = await request(app)
        .post(`/api/worker-certificates/${certificado.id}/review`)
        .set(as(rh.token))
        .send({ status: "APPROVED" });
      expect(proprio.status).toBe(403);
      expect(proprio.body.code).toBe("OWN_CERTIFICATE_REVIEW");

      const guardado = await prisma.workerCertificate.findFirstOrThrow({
        where: { id: certificado.id },
        select: { status: true, reviewedById: true },
      });
      expect(guardado.status, "nada foi aceito").toBe("PENDING");
      expect(guardado.reviewedById).toBeNull();

      // Outra pessoa decide normalmente.
      const deOutro = await request(app)
        .post(`/api/worker-certificates/${certificado.id}/review`)
        .set(as(sst.token))
        .send({ status: "APPROVED" });
      expect([200, 403]).toContain(deOutro.status);
    } finally {
      await prisma.workerCertificate.delete({ where: { id: certificado.id } }).catch(() => {});
    }
  });
});
