import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O que a pessoa faz no portal entra na trilha, e a ficha diz o que mudou.
 *
 * O histórico da ficha registrava "Ficha alterada" e nada mais: função,
 * vínculo, CPF e matrícula ficavam gravados sem o valor anterior nem o novo
 * [CB-54]. E o pedido de férias, o envio do atestado e tudo da Gamificação
 * ficavam fora da trilha — só a decisão entrava, o que mostra a resposta sem
 * a pergunta [CB-67].
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
let fiscal = "";
let fichaId = "";
let funcaoOriginal: string | null = null;
let telefoneOriginal: string | null = null;
let outraFuncao = "";
const criados = { ferias: [] as string[], atestados: [] as string[], pontos: [] as string[] };

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

async function trilhaDaFicha() {
  const res = await request(app)
    .get(`/api/employee-profiles/${fichaId}/ficha`)
    .set(as(rh.token));
  expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
  return res.body.history as {
    action: string;
    changes: { field: string; label: string; from: string | null; to: string | null; hidden: boolean }[];
  }[];
}

beforeAll(async () => {
  app = createApp();
  rh = await entrar("teste.rh");
  colaborador = await entrar("teste.colaborador");
  fiscal = (await entrar("teste.fiscal")).token;

  const ficha = await prisma.employeeProfile.findFirstOrThrow({
    where: { organizationId: ORG_ID, userId: colaborador.user.id },
    select: { id: true, jobRoleId: true, phone: true },
  });
  fichaId = ficha.id;
  funcaoOriginal = ficha.jobRoleId;
  telefoneOriginal = ficha.phone;

  const outra = await prisma.jobRole.findFirst({
    where: { organizationId: ORG_ID, archivedAt: null, id: { not: funcaoOriginal ?? "" } },
    select: { id: true },
  });
  outraFuncao = outra!.id;
});

afterAll(async () => {
  await prisma.employeeProfile.update({
    where: { id: fichaId },
    data: { jobRoleId: funcaoOriginal, phone: telefoneOriginal },
  });
  await prisma.auditEvent.deleteMany({
    where: {
      entityId: { in: [...criados.ferias, ...criados.atestados, ...criados.pontos] },
    },
  });
  await prisma.leaveRequest.deleteMany({ where: { id: { in: criados.ferias } } });
  await prisma.medicalCertificate.deleteMany({ where: { id: { in: criados.atestados } } });
  await prisma.pointEntry.deleteMany({ where: { id: { in: criados.pontos } } });
});

describe("a ficha diz o que mudou [CB-54]", () => {
  it("trocar a função registra o valor anterior e o novo", async () => {
    const res = await request(app)
      .patch(`/api/employee-profiles/${fichaId}`)
      .set(as(rh.token))
      .send({ job_role_id: outraFuncao });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const historico = await trilhaDaFicha();
    const alteracao = historico.find((h) => h.action === "employee_profile.update");
    expect(alteracao, "a alteração aparece").toBeTruthy();
    const mudancaDaFuncao = alteracao!.changes.find((c) => c.field === "jobRoleId");
    /*
      É o defeito do achado: ficava "Ficha alterada" e nada dizia o que
      tinha mudado.
    */
    expect(mudancaDaFuncao, "a função aparece entre as mudanças").toBeTruthy();
    expect(mudancaDaFuncao!.from).toBe(funcaoOriginal);
    expect(mudancaDaFuncao!.to).toBe(outraFuncao);
    expect(mudancaDaFuncao!.label).toBe("função");
  });

  it("o que não mudou não entra na lista", async () => {
    await request(app)
      .patch(`/api/employee-profiles/${fichaId}`)
      .set(as(rh.token))
      .send({ phone: `11999${SUFIXO.slice(0, 5)}` })
      .expect(200);

    const historico = await trilhaDaFicha();
    const ultima = historico.find((h) => h.action === "employee_profile.update")!;
    expect(ultima.changes.map((c) => c.field)).toEqual(["phone"]);
  });

  it("quem só consulta não lê CPF nem telefone pelo histórico [CB-43]", async () => {
    const res = await request(app)
      .get(`/api/employee-profiles/${fichaId}/ficha`)
      .set(as(fiscal));
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    const comMudanca = (res.body.history as {
      changes: { field: string; from: string | null; to: string | null; hidden: boolean }[];
    }[]).flatMap((h) => h.changes);
    const reservados = comMudanca.filter((c) => c.field === "phone" || c.field === "taxId");
    expect(reservados.length, "o telefone mudou e aparece na lista").toBeGreaterThan(0);
    /*
      O histórico não pode ser a porta dos fundos para o que a decisão CB-43
      tirou da ficha.
    */
    expect(reservados.every((c) => c.hidden && c.from === null && c.to === null)).toBe(true);
  });
});

describe("o que a pessoa pediu entra na trilha [CB-67]", () => {
  it("o pedido de férias é registrado, não só a decisão", async () => {
    const res = await request(app)
      .post("/api/leaves")
      .set(as(colaborador.token))
      .send({
        kind: "VACATION",
        start_date: "2027-01-10",
        end_date: "2027-01-20",
        note: `Teste ${SUFIXO}`,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    criados.ferias.push(res.body.leave.id);

    const fatos = await prisma.auditEvent.findMany({
      where: { organizationId: ORG_ID, entityId: res.body.leave.id },
      select: { action: true, actorId: true },
    });
    expect(fatos.map((f) => f.action)).toContain("leave.request");
    expect(fatos.find((f) => f.action === "leave.request")!.actorId).toBe(
      colaborador.user.id,
    );
  });

  it("os pontos lançados ficam registrados, com quem lançou", async () => {
    const res = await request(app)
      .post("/api/point-entries")
      .set(as(rh.token))
      .send({
        user_id: colaborador.user.id,
        activity: `Participou do DDS ${SUFIXO}`,
        points: 10,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    criados.pontos.push(res.body.entry.id);

    const fatos = await prisma.auditEvent.findMany({
      where: { organizationId: ORG_ID, entityId: res.body.entry.id },
      select: { action: true, actorId: true },
    });
    expect(fatos.map((f) => f.action)).toContain("gamification.points");
    expect(fatos[0]!.actorId, "ponto é valor: quem lançou fica registrado").toBe(
      rh.user.id,
    );
  });
});
