import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Comitê abre o relato e responde [S5-L]; quem denunciou responde de volta
 * pelo protocolo, sem se identificar [S5-P].
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const SENHA = "teste1234";

async function entrar(app: Express, login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body.token as string;
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: string;
let colaborador: string;
let gerente: string;
let protocol: string;
let code: string;
let reportId: string;

beforeAll(async () => {
  app = createApp();
  rh = await entrar(app, "teste.rh");
  colaborador = await entrar(app, "teste.colaborador");
  gerente = await entrar(app, "teste.gerente");

  const res = await request(app)
    .post("/api/ethics-reports")
    .set(as(colaborador))
    .send({ category: "HARASSMENT_MORAL", description: "Gritos frequentes na reunião da manhã", is_anonymous: true });
  expect(res.status).toBe(201);
  protocol = res.body.report.protocol;
  code = res.body.access_code;
  reportId = res.body.report.id;
});

const track = () => request(app).post("/api/ethics-reports/track").send({ protocol, access_code: code });

describe("a conversa entre o comitê e quem denunciou", () => {
  it("o comitê abre o relato anônimo sem saber quem é [S5-L]", async () => {
    const lista = await request(app).get("/api/ethics-reports").set(as(rh));
    const row = (lista.body.reports as { id: string; reporterUserId: string | null; unread_from_reporter: number }[]).find(
      (r) => r.id === reportId,
    );
    expect(row?.reporterUserId).toBeNull();
    expect(row?.unread_from_reporter).toBe(0);

    const aberto = await request(app).get(`/api/ethics-reports/${reportId}`).set(as(rh));
    expect(aberto.status).toBe(200);
    expect(aberto.body.report.reporterUserId).toBeNull();
    expect(aberto.body.report.accessCodeHash).toBeUndefined();
  });

  it("o comitê pede mais informação; quem denunciou lê sem ver o nome de quem respondeu", async () => {
    const msg = await request(app)
      .post(`/api/ethics-reports/${reportId}/messages`)
      .set(as(rh))
      .send({ body: "Pode dizer em que dias isso aconteceu?" });
    expect(msg.status).toBe(201);
    const status = await request(app)
      .patch(`/api/ethics-reports/${reportId}`)
      .set(as(rh))
      .send({ status: "AWAITING_INFO" });
    expect(status.status).toBe(200);

    const visto = await track();
    expect(visto.status).toBe(200);
    expect(visto.body.report.status).toBe("AWAITING_INFO");
    const [m] = visto.body.report.messages;
    expect(m.side).toBe("COMMITTEE");
    expect(m.body).toMatch(/em que dias/);
    expect(m).not.toHaveProperty("author");
    expect(m).not.toHaveProperty("authorUserId");
  });

  it("quem denunciou responde, sem login e sem deixar rastro de quem é [S5-P]", async () => {
    const res = await request(app)
      .post("/api/ethics-reports/messages")
      .send({ protocol, access_code: code, body: "Segunda e quarta, na reunião das 8h." });
    expect(res.status).toBe(201);

    // responder logado também não grava o autor
    const logado = await request(app)
      .post("/api/ethics-reports/messages")
      .set(as(colaborador))
      .send({ protocol, access_code: code, body: "Também na sexta passada." });
    expect(logado.status).toBe(201);

    const doDenunciante = await prisma.ethicsReportMessage.findMany({
      where: { reportId, side: "REPORTER" },
      select: { authorUserId: true },
    });
    expect(doDenunciante).toHaveLength(2);
    expect(doDenunciante.every((x) => x.authorUserId === null)).toBe(true);

    // a resposta tira o relato de "aguardando"
    expect((await track()).body.report.status).toBe("IN_ANALYSIS");
  });

  it("o comitê vê que há resposta nova, e abrir marca como lida", async () => {
    const antes = await request(app).get("/api/ethics-reports").set(as(rh));
    const row = (antes.body.reports as { id: string; unread_from_reporter: number }[]).find((r) => r.id === reportId);
    expect(row?.unread_from_reporter).toBe(2);

    const aberto = await request(app).get(`/api/ethics-reports/${reportId}`).set(as(rh));
    const doDenunciante = (aberto.body.report.messages as { side: string; author: unknown }[]).filter(
      (x) => x.side === "REPORTER",
    );
    expect(doDenunciante.every((x) => x.author === null)).toBe(true);

    const depois = await request(app).get("/api/ethics-reports").set(as(rh));
    expect(
      (depois.body.reports as { id: string; unread_from_reporter: number }[]).find((r) => r.id === reportId)
        ?.unread_from_reporter,
    ).toBe(0);
  });

  it("encerrado: quem denunciou lê o desfecho, e ninguém escreve mais", async () => {
    const fim = await request(app)
      .patch(`/api/ethics-reports/${reportId}`)
      .set(as(rh))
      .send({ status: "RESOLVED", resolution_note: "Gestor orientado e acompanhado pelo RH." });
    expect(fim.status).toBe(200);

    const visto = await track();
    expect(visto.body.report.status).toBe("RESOLVED");
    expect(visto.body.report.resolutionNote).toMatch(/orientado/);

    const denunciante = await request(app)
      .post("/api/ethics-reports/messages")
      .send({ protocol, access_code: code, body: "Obrigado." });
    expect(denunciante.status).toBe(409);
    const comite = await request(app)
      .post(`/api/ethics-reports/${reportId}/messages`)
      .set(as(rh))
      .send({ body: "Mais alguma coisa?" });
    expect(comite.status).toBe(409);
  });

  it("fora do comitê ninguém abre o relato", async () => {
    expect((await request(app).get(`/api/ethics-reports/${reportId}`).set(as(gerente))).status).toBe(403);
    expect((await request(app).get(`/api/ethics-reports/${reportId}`).set(as(colaborador))).status).toBe(403);
  });
});
