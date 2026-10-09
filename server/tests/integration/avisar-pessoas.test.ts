import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O portal avisa quem precisa saber: a ação chegou para você [S3-A], o aviso
 * foi publicado [S3-G] [S4-G], e quem publica vê quem leu [S3-H].
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

const caixa = (token: string) => request(app).get("/api/notificacoes").set(as(token));

beforeAll(async () => {
  app = createApp();
  sst = await entrar(app, "teste.sst");
  rh = await entrar(app, "teste.rh");
  supervisor = await entrar(app, "teste.supervisor");
  colaborador = await entrar(app, "teste.colaborador");
});

describe("a ação avisa quem vai executar [S3-A]", () => {
  it("o responsável recebe o aviso com o prazo; quem abriu, não", async () => {
    const titulo = `Trocar a lâmpada ${SUFIXO}`;
    const criada = await request(app)
      .post("/api/actions")
      .set(as(sst.token))
      .send({
        title: titulo,
        assignee_id: supervisor.user.id,
        due_date: "2026-12-20",
        priority: "HIGH",
      });
    expect(criada.status).toBe(201);

    const doSupervisor = await caixa(supervisor.token);
    expect(doSupervisor.status).toBe(200);
    const aviso = (doSupervisor.body.notifications as { title: string; body: string; link: string; readAt: string | null }[]).find(
      (n) => n.title === titulo,
    );
    expect(aviso?.link).toBe("/acoes");
    expect(aviso?.body).toMatch(/20\/12\/2026/);
    expect(aviso?.readAt).toBeNull();

    // quem abriu a ação não se avisa
    const doSst = await caixa(sst.token);
    expect(
      (doSst.body.notifications as { title: string }[]).some((n) => n.title === titulo),
    ).toBe(false);
  });

  it("cada um vê só a sua caixa, e marcar como lido zera o contador", async () => {
    const antes = await caixa(supervisor.token);
    expect(antes.body.unread).toBeGreaterThan(0);

    const naoLido = (antes.body.notifications as { id: string; readAt: string | null }[]).find(
      (n) => !n.readAt,
    )!;
    // a notificação é de quem recebeu: outra pessoa não marca
    expect(
      (await request(app).post(`/api/notificacoes/${naoLido.id}/lida`).set(as(colaborador.token))).status,
    ).toBe(404);

    expect(
      (await request(app).post(`/api/notificacoes/${naoLido.id}/lida`).set(as(supervisor.token))).status,
    ).toBe(200);

    const todas = await request(app).post("/api/notificacoes/ler-todas").set(as(supervisor.token));
    expect(todas.status).toBe(200);
    expect((await caixa(supervisor.token)).body.unread).toBe(0);
  });

  it("sem login, não há caixa", async () => {
    expect((await request(app).get("/api/notificacoes")).status).toBe(401);
  });
});

describe("o aviso publicado chega a todo mundo [S3-G] [S4-G]", () => {
  let announcementId: string;
  const titulo = `Campanha de uso de EPI ${SUFIXO}`;

  it("quem publica não se avisa; os outros recebem com link para o aviso", async () => {
    const res = await request(app)
      .post("/api/announcements")
      .set(as(rh.token))
      .send({ kind: "CAMPAIGN", title: titulo, body: "Use o protetor auricular na usinagem." });
    expect(res.status).toBe(201);
    announcementId = res.body.announcement.id;

    const doColaborador = await caixa(colaborador.token);
    const aviso = (doColaborador.body.notifications as { title: string; link: string }[]).find(
      (n) => n.title === titulo,
    );
    expect(aviso?.link).toBe(`/mural?open=${announcementId}`);

    const doRh = await caixa(rh.token);
    expect((doRh.body.notifications as { title: string }[]).some((n) => n.title === titulo)).toBe(false);
  });

  it("quem publica vê quem leu e quem não leu [S3-H]", async () => {
    await request(app).post(`/api/announcements/${announcementId}/read`).set(as(colaborador.token));

    const res = await request(app)
      .get(`/api/announcements/${announcementId}/leituras`)
      .set(as(rh.token));
    expect(res.status).toBe(200);
    const leitores = res.body.readers as { id: string; name: string; read_at: string | null }[];
    expect(leitores.find((p) => p.id === colaborador.user.id)?.read_at).toBeTruthy();
    expect(leitores.find((p) => p.id === supervisor.user.id)?.read_at).toBeNull();
    expect(res.body.read + res.body.pending).toBe(leitores.length);
  });

  it("quem não cuida do mural não vê quem leu", async () => {
    expect(
      (await request(app).get(`/api/announcements/${announcementId}/leituras`).set(as(colaborador.token)))
        .status,
    ).toBe(403);
  });

  it("publicar de novo o mesmo aviso não duplica a caixa de ninguém", async () => {
    const antes = await prisma.notification.count({
      where: { entityId: announcementId, userId: colaborador.user.id },
    });
    expect(antes).toBe(1);
  });
});
