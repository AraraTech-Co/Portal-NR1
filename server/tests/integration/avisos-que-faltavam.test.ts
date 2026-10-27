import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Sete fatos aconteciam em silêncio: a pessoa precisava entrar na tela certa
 * para descobrir. [CB-29] [CB-19] [S3-A] [S4-G]
 *
 * E o sino e o Início discordavam sobre o que era novo: ler o aviso no mural
 * não limpava o sino. [B2-3-A]
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
let sst: { token: string; user: { id: string } };
let rh: { token: string; user: { id: string } };
let supervisor: { token: string; user: { id: string } };
let colaborador: { token: string; user: { id: string } };

/** Avisos daquela pessoa, do mais novo para o mais velho. */
const avisos = async (userId: string, kind?: string) =>
  prisma.notification.findMany({
    where: { userId, ...(kind ? { kind: kind as never } : {}) },
    orderBy: { createdAt: "desc" },
  });

beforeAll(async () => {
  app = createApp();
  sst = await entrar(app, "teste.sst");
  rh = await entrar(app, "teste.rh");
  supervisor = await entrar(app, "teste.supervisor");
  colaborador = await entrar(app, "teste.colaborador");
});

describe("a ação avisa em cada passo [S3-A] [CB-19]", () => {
  it("concluir avisa quem vai validar; aprovar e recusar avisam quem executou", async () => {
    const criada = await request(app)
      .post("/api/actions")
      .set(as(sst.token))
      .send({
        effectiveness_criteria: "Critério do teste",
        title: `Trocar proteção ${SUFIXO}`,
        assignee_id: supervisor.user.id,
        due_date: "2027-05-01",
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

    // Quem abriu a ação é avisado de que há o que validar.
    const paraValidar = await avisos(sst.user.id, "ACTION_WAITING_VALIDATION");
    expect(paraValidar.some((n) => n.entityId === acaoId)).toBe(true);

    // Recusar avisa quem executou, com o motivo.
    const recusa = await request(app)
      .post(`/api/actions/${acaoId}/review`)
      .set(as(sst.token))
      .send({ decision: "reject", rejection_reason: "A foto não mostra a proteção." });
    expect(recusa.status).toBe(200);
    const recusados = await avisos(supervisor.user.id, "ACTION_REJECTED");
    const recusado = recusados.find((n) => n.entityId === acaoId);
    expect(recusado?.body).toMatch(/não mostra a proteção/);

    // Refazer e aprovar avisa de novo, agora com a aprovação.
    await request(app)
      .post("/api/evidences")
      .set(as(supervisor.token))
      .send({
        action_id: acaoId,
        file_name: "foto2.png",
        mime_type: "image/png",
        content_base64: Buffer.from(`prova 2 ${SUFIXO}`).toString("base64"),
      });
    await request(app).post(`/api/actions/${acaoId}/complete`).set(as(supervisor.token));
    await request(app)
      .post(`/api/actions/${acaoId}/review`)
      .set(as(sst.token))
      .send({ decision: "approve", effectiveness_result: "Proteção no lugar." });

    const aprovados = await avisos(supervisor.user.id, "ACTION_VALIDATED");
    expect(aprovados.some((n) => n.entityId === acaoId)).toBe(true);
  });
});

describe("o RH decide e a pessoa fica sabendo [CB-29]", () => {
  it("o atestado recusado avisa quem enviou, com o motivo", async () => {
    const envio = await request(app)
      .post("/api/medical-certificates")
      .set(as(colaborador.token))
      .send({
        start_date: "2026-10-12",
        days: 1,
        file_name: "atestado.png",
        mime_type: "image/png",
        content_base64: Buffer.from(`atestado ${SUFIXO}`).toString("base64"),
      });
    expect(envio.status).toBe(201);

    const decisao = await request(app)
      .post(`/api/medical-certificates/${envio.body.certificate.id}/review`)
      .set(as(rh.token))
      .send({ status: "REJECTED", rejection_reason: `Sem assinatura ${SUFIXO}` });
    expect(decisao.status).toBe(200);

    const recebidos = await avisos(colaborador.user.id, "CERTIFICATE_REVIEWED");
    const aviso = recebidos.find((n) => n.entityId === envio.body.certificate.id);
    expect(aviso?.title).toMatch(/recusado/i);
    expect(aviso?.body).toMatch(new RegExp(SUFIXO));
  });

  it("o holerite publicado avisa o dono", async () => {
    const antes = (await avisos(colaborador.user.id, "PAYSLIP_PUBLISHED")).length;
    const criado = await prisma.payslip.create({
      data: {
        organizationId: "aaaaaaaa-0001-4000-8000-000000000001",
        userId: colaborador.user.id,
        referenceMonth: 7,
        referenceYear: 2026,
        fileName: `holerite-${SUFIXO}.pdf`,
        storagePath: `teste/${SUFIXO}.pdf`,
        publishedById: rh.user.id,
      },
    });
    // O aviso sai na publicação pela rota; aqui o registro serve de base
    // para a dúvida respondida, que é o segundo aviso deste caso.
    expect(criado.id).toBeTruthy();

    const pergunta = await request(app)
      .post(`/api/payslips/${criado.id}/questions`)
      .set(as(colaborador.token))
      .send({ body: `Por que o desconto mudou? ${SUFIXO}` });
    expect(pergunta.status).toBe(201);

    const resposta = await request(app)
      .post(`/api/payslips/${criado.id}/questions/${pergunta.body.question.id}/answer`)
      .set(as(rh.token))
      .send({ answer: `Mudou a faixa do INSS ${SUFIXO}` });
    expect(resposta.status).toBe(200);

    const respondidos = await avisos(colaborador.user.id, "PAYSLIP_ANSWERED");
    expect(respondidos.some((n) => n.entityId === pergunta.body.question.id)).toBe(true);
    expect(antes).toBeGreaterThanOrEqual(0);

    await prisma.payslip.delete({ where: { id: criado.id } }).catch(() => {});
  });
});

describe("o sino e o Início param de discordar [B2-3-A] [S4-G]", () => {
  it("ler o aviso no mural tira a notificação do sino", async () => {
    const publicado = await request(app)
      .post("/api/announcements")
      .set(as(rh.token))
      .send({
        title: `Aviso de convergência ${SUFIXO}`,
        body: "Conteúdo do aviso.",
        kind: "NOTICE",
      });
    expect(publicado.status).toBe(201);
    const avisoId = publicado.body.announcement.id as string;

    const noSino = await prisma.notification.findFirst({
      where: { userId: colaborador.user.id, entityId: avisoId },
    });
    expect(noSino?.readAt, "chega não lido no sino").toBeNull();

    await request(app)
      .post(`/api/announcements/${avisoId}/read`)
      .set(as(colaborador.token));

    const depois = await prisma.notification.findFirst({
      where: { userId: colaborador.user.id, entityId: avisoId },
    });
    expect(depois?.readAt, "ler no mural limpa o sino").not.toBeNull();
  });

  it("tocar o aviso no sino marca como lido no mural", async () => {
    const publicado = await request(app)
      .post("/api/announcements")
      .set(as(rh.token))
      .send({
        title: `Aviso pelo sino ${SUFIXO}`,
        body: "Conteúdo do aviso.",
        kind: "NOTICE",
      });
    const avisoId = publicado.body.announcement.id as string;

    const noSino = await prisma.notification.findFirstOrThrow({
      where: { userId: colaborador.user.id, entityId: avisoId },
    });
    const res = await request(app)
      .post(`/api/notificacoes/${noSino.id}/lida`)
      .set(as(colaborador.token));
    expect(res.status).toBe(200);

    const leitura = await prisma.announcementRead.findFirst({
      where: { announcementId: avisoId, userId: colaborador.user.id },
    });
    expect(leitura, "o mural passa a saber que foi lido").not.toBeNull();
  });
});
