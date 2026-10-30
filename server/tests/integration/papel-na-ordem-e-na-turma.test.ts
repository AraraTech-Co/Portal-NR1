import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { pdfBase64 } from "../helpers/pdf";

/**
 * O papel assinado da ordem de serviço e da turma. [CB-74]
 *
 * A decisão B3-4-F cita o comprovante da ordem de serviço, a lista de
 * presença da turma, o simulado e a participação; só os dois últimos
 * recebiam anexo. Agora a ordem de serviço e a turma também recebem —
 * opcional, para quem colheu assinatura — e o papel sai para quem vê a
 * lista de ciência ou as turmas.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

type Sessao = { token: string; user: { id: string } };
let app: Express;
let sst: Sessao;
let rh: Sessao;
let fiscal: Sessao;
let colaborador: Sessao;
let ordem = "";
const treinamentos: string[] = [];
const turmas: string[] = [];
const papeis: string[] = [];

const as = (s: Sessao) => ({ Authorization: `Bearer ${s.token}` });
const papel = (nome: string) => ({
  file_name: nome,
  mime_type: "application/pdf",
  content_base64: pdfBase64(["Lista assinada", nome]),
  description: "Assinada em papel",
});

async function entrar(login: string): Promise<Sessao> {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as Sessao;
}

async function turma() {
  const curso = await request(app)
    .post("/api/trainings")
    .set(as(rh))
    .send({ title: `Presencial ${SUFIXO}`, kind: "CLASSROOM", duration_minutes: 60 });
  expect(curso.status, JSON.stringify(curso.body)).toBe(201);
  const trainingId = curso.body.training.id as string;
  treinamentos.push(trainingId);
  const t = await request(app)
    .post(`/api/trainings/${trainingId}/turmas`)
    .set(as(rh))
    .send({
      held_at: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
      instructor_name: "Marcos Lima",
      duration_minutes: 60,
      attendees: [{ user_id: colaborador.user.id, present: true }],
    });
  expect(t.status, JSON.stringify(t.body)).toBe(201);
  const s = await prisma.trainingSession.findFirstOrThrow({ where: { trainingId } });
  turmas.push(s.id);
  return { trainingId, sessionId: s.id };
}

beforeAll(async () => {
  app = createApp();
  sst = await entrar("teste.sst");
  rh = await entrar("teste.rh");
  fiscal = await entrar("teste.fiscal");
  colaborador = await entrar("teste.colaborador");
  const o = await prisma.serviceOrder.findFirstOrThrow({
    where: { organizationId: ORG },
    orderBy: { issuedAt: "desc" },
    select: { id: true },
  });
  ordem = o.id;
});

afterAll(async () => {
  const evidencias = await prisma.evidence.findMany({
    where: { OR: [{ serviceOrderId: ordem }, { trainingSession: { trainingId: { in: treinamentos } } }] },
    select: { id: true },
  });
  await prisma.auditEvent.deleteMany({
    where: {
      OR: [
        { entityId: ordem, action: "service_order.paper" },
        { entityId: { in: [...treinamentos, ...turmas] } },
      ],
    },
  });
  await prisma.evidence.deleteMany({ where: { id: { in: [...evidencias.map((e) => e.id), ...papeis] } } });
  await prisma.notification.deleteMany({ where: { entityId: { in: treinamentos } } });
  await prisma.training.deleteMany({ where: { id: { in: treinamentos } } });
});

describe("o comprovante assinado da ordem de serviço [CB-74]", () => {
  it("quem emite anexa; a lista de ciência traz o papel; a fiscal abre o arquivo", async () => {
    const res = await request(app)
      .post(`/api/service-orders/${ordem}/papel`)
      .set(as(sst))
      .send(papel(`comprovante-${SUFIXO}.pdf`));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.paper.id as string;
    papeis.push(id);

    const lista = await request(app).get(`/api/service-orders/${ordem}/ciencias`).set(as(fiscal));
    expect(lista.status).toBe(200);
    expect((lista.body.papers as { id: string; description: string }[]).find((p) => p.id === id))
      .toMatchObject({ description: "Assinada em papel" });

    const arquivo = await request(app)
      .get(`/api/service-orders/${ordem}/papel/${id}/file`)
      .set(as(fiscal));
    expect(arquivo.status).toBe(200);
    expect(arquivo.headers["content-type"]).toContain("application/pdf");

    const trilha = await prisma.auditEvent.findFirst({
      where: { entityId: ordem, action: "service_order.paper" },
      orderBy: { createdAt: "desc" },
    });
    expect(trilha?.after).toMatchObject({ evidenceId: id });
  });

  it("o colaborador não anexa nem abre o comprovante", async () => {
    const envio = await request(app)
      .post(`/api/service-orders/${ordem}/papel`)
      .set(as(colaborador))
      .send(papel("tentativa.pdf"));
    expect(envio.status).toBe(403);
    const qualquer = papeis[0]!;
    const abrir = await request(app)
      .get(`/api/service-orders/${ordem}/papel/${qualquer}/file`)
      .set(as(colaborador));
    expect(abrir.status).toBe(403);
  });

  it("sem arquivo não grava nada", async () => {
    const antes = await prisma.evidence.count({ where: { serviceOrderId: ordem } });
    const res = await request(app)
      .post(`/api/service-orders/${ordem}/papel`)
      .set(as(sst))
      .send({ file_name: "vazio.pdf", mime_type: "application/pdf" });
    expect(res.status).toBe(400);
    expect(await prisma.evidence.count({ where: { serviceOrderId: ordem } })).toBe(antes);
  });
});

describe("a lista de presença assinada da turma [CB-74]", () => {
  it("quem cuida dos treinamentos anexa; a lista de turmas traz o papel; o arquivo abre", async () => {
    const { trainingId, sessionId } = await turma();
    const res = await request(app)
      .post(`/api/trainings/${trainingId}/turmas/${sessionId}/papel`)
      .set(as(rh))
      .send(papel(`presenca-${SUFIXO}.pdf`));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.paper.id as string;

    const lista = await request(app).get(`/api/trainings/${trainingId}/turmas`).set(as(rh));
    const sessao = (lista.body.sessions as { id: string; papers: { id: string }[] }[]).find(
      (s) => s.id === sessionId,
    )!;
    expect(sessao.papers.map((p) => p.id)).toEqual([id]);

    const arquivo = await request(app)
      .get(`/api/trainings/${trainingId}/turmas/${sessionId}/papel/${id}/file`)
      .set(as(rh));
    expect(arquivo.status).toBe(200);

    const gravada = await prisma.evidence.findUniqueOrThrow({ where: { id } });
    const turmaGravada = await prisma.trainingSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(gravada.eventDate?.toISOString(), "a data do papel é a da turma").toBe(
      turmaGravada.heldAt.toISOString(),
    );
    expect(
      await prisma.auditEvent.count({ where: { entityId: sessionId, action: "training.session_paper" } }),
    ).toBe(1);
  });

  it("o colaborador não anexa, e o papel de outra turma não abre por esta", async () => {
    const a = await turma();
    const b = await turma();
    const envio = await request(app)
      .post(`/api/trainings/${a.trainingId}/turmas/${a.sessionId}/papel`)
      .set(as(colaborador))
      .send(papel("tentativa.pdf"));
    expect(envio.status).toBe(403);

    const deB = await request(app)
      .post(`/api/trainings/${b.trainingId}/turmas/${b.sessionId}/papel`)
      .set(as(rh))
      .send(papel("de-b.pdf"));
    expect(deB.status).toBe(201);
    const cruzado = await request(app)
      .get(`/api/trainings/${a.trainingId}/turmas/${a.sessionId}/papel/${deB.body.paper.id}/file`)
      .set(as(rh));
    expect(cruzado.status).toBe(404);

    /* Duas turmas do mesmo curso: o papel de uma não abre pela outra. */
    const segunda = await request(app)
      .post(`/api/trainings/${a.trainingId}/turmas`)
      .set(as(rh))
      .send({
        held_at: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10),
        instructor_name: "Outra pessoa",
        duration_minutes: 60,
        attendees: [{ user_id: colaborador.user.id, present: true }],
      });
    expect(segunda.status, JSON.stringify(segunda.body)).toBe(201);
    const outra = await prisma.trainingSession.findFirstOrThrow({
      where: { trainingId: a.trainingId, id: { not: a.sessionId } },
    });
    turmas.push(outra.id);
    const daOutra = await request(app)
      .post(`/api/trainings/${a.trainingId}/turmas/${outra.id}/papel`)
      .set(as(rh))
      .send(papel("da-outra.pdf"));
    expect(daOutra.status).toBe(201);
    const pelaPrimeira = await request(app)
      .get(`/api/trainings/${a.trainingId}/turmas/${a.sessionId}/papel/${daOutra.body.paper.id}/file`)
      .set(as(rh));
    expect(pelaPrimeira.status).toBe(404);
  });
});
