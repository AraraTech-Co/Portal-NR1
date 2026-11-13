import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Treinamentos no recorte por unidade (decisão D4-2 do Léo). [C4-17]
 *
 * Empresa própria com a Loja A e a Loja B. O Gil gere a A; a Ana trabalha na
 * A e a Bia na B; a Rita é do RH. Um treinamento presencial com a Ana e a
 * Bia matriculadas e numa turma. O gerente da A não vê nem conta a Bia.
 *
 * Apagada no fim.
 */
const SUFIXO = Date.now().toString(36);
const SENHA = ["c417", "treino", "recorte"].join("-");
const as = (t: string) => ({ Authorization: `Bearer ${t}` });
const DIA = 24 * 3600_000;

let app: Express;
let orgId = "";
let contaId = "";
const usuarios: string[] = [];
const id: Record<string, string> = {};
const token: Record<string, string> = {};
let lojaA = "";
let lojaB = "";
let treinamento = "";
let turma = "";
const matricula: Record<string, string> = {};

async function pessoa(nome: string, role: Role, loja: string | null, gere?: string) {
  const login = `c417.${nome.toLowerCase()}.${SUFIXO}`;
  const user = await prisma.user.create({ data: { login, name: `${nome} ${SUFIXO}`, passwordHash: await bcrypt.hash(SENHA, 4) } });
  usuarios.push(user.id);
  id[nome] = user.id;
  const m = await prisma.membership.create({ data: { userId: user.id, organizationId: orgId, role } });
  await prisma.accountMembership.create({ data: { accountId: contaId, userId: user.id, role: AccountRole.USER } });
  if (loja) await prisma.employeeProfile.create({ data: { organizationId: orgId, userId: user.id, establishmentId: loja } });
  if (gere) {
    await prisma.managedEstablishment.create({
      data: { organizationId: orgId, membershipId: m.id, establishmentId: gere, createdById: user.id },
    });
  }
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  token[nome] = res.body.token;
}

beforeAll(async () => {
  app = createApp();
  orgId = (await prisma.organization.create({ data: { name: `C417 ${SUFIXO}` } })).id;
  contaId = (await prisma.account.create({ data: { organizationId: orgId, name: `Conta C417 ${SUFIXO}` } })).id;
  lojaA = (await prisma.establishment.create({ data: { organizationId: orgId, name: `Loja A ${SUFIXO}` } })).id;
  lojaB = (await prisma.establishment.create({ data: { organizationId: orgId, name: `Loja B ${SUFIXO}` } })).id;
  await pessoa("Gil", Role.GERENTE, lojaA, lojaA);
  await pessoa("Ana", Role.COLABORADOR, lojaA);
  await pessoa("Bia", Role.COLABORADOR, lojaB);
  await pessoa("Rita", Role.RH, null);

  treinamento = (
    await prisma.training.create({
      data: { organizationId: orgId, title: `NR-35 ${SUFIXO}`, kind: "CLASSROOM", validityMonths: 12, createdById: id.Rita! },
    })
  ).id;
  for (const nome of ["Ana", "Bia"]) {
    matricula[nome] = (
      await prisma.trainingEnrollment.create({
        data: {
          trainingId: treinamento,
          userId: id[nome]!,
          status: "COMPLETED",
          completedAt: new Date(),
          score: 90,
          certificateCode: `C417-${nome}-${SUFIXO}`,
          expiresAt: new Date(Date.now() + 10 * DIA),
        },
      })
    ).id;
  }
  turma = (
    await prisma.trainingSession.create({
      data: {
        organizationId: orgId,
        trainingId: treinamento,
        heldAt: new Date(Date.now() - DIA),
        instructorName: "Instrutor",
        durationMinutes: 240,
        recordedById: id.Rita!,
      },
    })
  ).id;
  await prisma.trainingAttendance.createMany({
    data: [
      { sessionId: turma, userId: id.Ana!, present: true },
      { sessionId: turma, userId: id.Bia!, present: true },
    ],
  });
});

afterAll(async () => {
  if (!orgId) return;
  await prisma.notification.deleteMany({ where: { organizationId: orgId } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.trainingAttendance.deleteMany({ where: { session: { organizationId: orgId } } });
  await prisma.trainingSession.deleteMany({ where: { organizationId: orgId } });
  await prisma.trainingEnrollment.deleteMany({ where: { training: { organizationId: orgId } } });
  await prisma.training.deleteMany({ where: { organizationId: orgId } });
  await prisma.managedEstablishment.deleteMany({ where: { organizationId: orgId } });
  await prisma.employeeProfile.deleteMany({ where: { organizationId: orgId } });
  await prisma.accountMembership.deleteMany({ where: { accountId: contaId } });
  await prisma.membership.deleteMany({ where: { organizationId: orgId } });
  await prisma.token.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.establishment.deleteMany({ where: { organizationId: orgId } });
  await prisma.account.deleteMany({ where: { id: contaId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
});

describe("treinamentos no recorte por unidade [C4-17]", () => {
  it("a contagem de inscritos: o gerente da A conta 1; o RH conta 2", async () => {
    const doGil = await request(app).get("/api/trainings").set(as(token.Gil!));
    const daRita = await request(app).get("/api/trainings").set(as(token.Rita!));
    const acha = (r: { body: { trainings: { id: string; _count: { enrollments: number } }[] } }) =>
      r.body.trainings.find((t) => t.id === treinamento)!._count.enrollments;
    expect(acha(doGil)).toBe(1);
    expect(acha(daRita)).toBe(2);
  });

  it("quem fez: o gerente da A vê a Ana e não a Bia", async () => {
    const res = await request(app).get(`/api/trainings/${treinamento}/enrollments`).set(as(token.Gil!));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.enrollments.map((e: { user: { id: string } }) => e.user.id)).toEqual([id.Ana]);
    const rh = await request(app).get(`/api/trainings/${treinamento}/enrollments`).set(as(token.Rita!));
    expect(rh.body.enrollments.length).toBe(2);
  });

  it("o certificado da Bia é de outra pessoa para o gerente da A; o da Ana abre", async () => {
    expect((await request(app).get(`/api/certificados/${matricula.Ana}`).set(as(token.Gil!))).status).toBe(200);
    expect((await request(app).get(`/api/certificados/${matricula.Bia}`).set(as(token.Gil!))).status).toBe(403);
  });

  it("a lista de presença da turma: o gerente da A vê só a Ana, e conta 1 presente", async () => {
    const res = await request(app).get(`/api/trainings/${treinamento}/turmas`).set(as(token.Gil!));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const t = res.body.sessions.find((s: { id: string }) => s.id === turma);
    expect(t.present).toBe(1);
    expect(t.attendances.map((a: { user: { id: string } }) => a.user.id)).toEqual([id.Ana]);
  });

  it("o gerente da A não lança presença de quem é da B", async () => {
    /* Turma sem lista ainda: a que já tem lista recusa outra antes (409). */
    const nova = await prisma.trainingSession.create({
      data: {
        organizationId: orgId,
        trainingId: treinamento,
        heldAt: new Date(Date.now() - DIA),
        instructorName: "Instrutor",
        durationMinutes: 60,
        recordedById: id.Rita!,
      },
    });
    const res = await request(app)
      .post(`/api/trainings/${treinamento}/turmas/${nova.id}/presenca`)
      .set(as(token.Gil!))
      .send({ attendees: [{ user_id: id.Bia, present: false }] });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("Há pessoas na lista fora das filiais que você gere.");
  });

  it("o gerente da A não convoca para turma quem é da B", async () => {
    const res = await request(app)
      .post(`/api/trainings/${treinamento}/turmas`)
      .set(as(token.Gil!))
      .send({
        held_at: new Date(Date.now() + 5 * DIA).toISOString(),
        instructor_name: "Instrutor",
        duration_minutes: 60,
        invite_user_ids: [id.Bia],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.message).toBe("Há pessoas na lista fora das filiais que você gere.");
  });

  it("o cartão 'Treinamentos a reciclar' do Início: o gerente da A conta 1; o RH conta 2", async () => {
    const cartao = async (t: string) => {
      const res = await request(app).get("/api/inicio").set(as(t));
      return [...(res.body.expiring ?? []), ...(res.body.desk ?? [])].find((c: { id: string }) => c.id === "treinamentos");
    };
    expect((await cartao(token.Gil!))?.count).toBe(1);
    expect((await cartao(token.Rita!))?.count).toBe(2);
  });
});
