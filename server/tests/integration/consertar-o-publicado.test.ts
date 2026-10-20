import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O que foi publicado se conserta, e o procedimento nasce na unidade certa.
 *
 * Aviso publicado não tinha conserto: nem corrigir um erro de digitação, nem
 * tirar do mural o que saiu errado [S3-I]. E o formulário de procedimento de
 * emergência já vinha com uma unidade escolhida, então quem cadastrava para
 * outra e não reparava gravava na unidade errada [CB-18].
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh = "";
let colaborador = "";
const avisos: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body.token as string;
}

async function publicar(titulo: string) {
  const res = await request(app)
    .post("/api/announcements")
    .set(as(rh))
    .send({ title: titulo, body: `Conteúdo origial ${SUFIXO}` });
  expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(201);
  avisos.push(res.body.announcement.id);
  return res.body.announcement.id as string;
}

/** O aviso como a pessoa o vê na lista do mural, ou undefined se sumiu. */
async function noMural(token: string, id: string) {
  const res = await request(app).get("/api/announcements").set(as(token));
  expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
  return (res.body.announcements as { id: string }[]).find((a) => a.id === id) as
    | Record<string, unknown>
    | undefined;
}

beforeAll(async () => {
  app = createApp();
  rh = await entrar("teste.rh");
  colaborador = await entrar("teste.colaborador");
});

afterAll(async () => {
  await prisma.announcementRevision.deleteMany({
    where: { announcementId: { in: avisos } },
  });
  await prisma.notification.deleteMany({
    where: { entityType: "Announcement", entityId: { in: avisos } },
  });
  await prisma.announcementRead.deleteMany({
    where: { announcementId: { in: avisos } },
  });
  await prisma.announcement.deleteMany({ where: { id: { in: avisos } } });
});

describe("corrigir o aviso publicado [S3-I]", () => {
  it("o texto novo entra, o anterior fica guardado e a correção aparece", async () => {
    const id = await publicar(`Aviso com erro ${SUFIXO}`);

    const res = await request(app)
      .patch(`/api/announcements/${id}`)
      .set(as(rh))
      .send({ title: `Aviso corrigido ${SUFIXO}`, body: `Conteúdo original ${SUFIXO}` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const visto = await noMural(colaborador, id);
    expect(visto?.title).toBe(`Aviso corrigido ${SUFIXO}`);
    expect(visto?.editedAt, "a correção fica à vista, não escondida").toBeTruthy();

    const guardado = await prisma.announcementRevision.findMany({
      where: { announcementId: id },
      select: { title: true, body: true },
    });
    expect(guardado.length).toBe(1);
    expect(guardado[0]!.title).toBe(`Aviso com erro ${SUFIXO}`);
    expect(guardado[0]!.body).toBe(`Conteúdo origial ${SUFIXO}`);
  });

  it("corrigir não apaga quem já leu", async () => {
    const id = await publicar(`Aviso já lido ${SUFIXO}`);
    const leu = await request(app)
      .post(`/api/announcements/${id}/read`)
      .set(as(colaborador));
    expect(leu.status, JSON.stringify(leu.body)).toBe(200);

    await request(app)
      .patch(`/api/announcements/${id}`)
      .set(as(rh))
      .send({ body: `Conteúdo corrigido ${SUFIXO}` })
      .expect(200);

    const visto = await noMural(colaborador, id);
    expect(visto?.read_at, "a leitura é prova: a correção não a apaga").toBeTruthy();
  });

  it("o público de um aviso publicado não se troca", async () => {
    const id = await publicar(`Aviso de público fixo ${SUFIXO}`);
    const unidade = await prisma.establishment.findFirstOrThrow({
      where: { organizationId: ORG_ID, archivedAt: null },
      select: { id: true },
    });
    const res = await request(app)
      .patch(`/api/announcements/${id}`)
      .set(as(rh))
      .send({ establishment_ids: [unidade.id] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AUDIENCE_IS_FIXED");
  });

  it("título ou conteúdo vazio é recusado, e sem nada para corrigir também", async () => {
    const id = await publicar(`Aviso a esvaziar ${SUFIXO}`);
    await request(app)
      .patch(`/api/announcements/${id}`)
      .set(as(rh))
      .send({ title: "   " })
      .expect(400);
    await request(app)
      .patch(`/api/announcements/${id}`)
      .set(as(rh))
      .send({})
      .expect(400);
  });

  it("quem só lê o mural não corrige nada", async () => {
    const id = await publicar(`Aviso do colaborador ${SUFIXO}`);
    const res = await request(app)
      .patch(`/api/announcements/${id}`)
      .set(as(colaborador))
      .send({ title: `Mexido ${SUFIXO}` });
    expect(res.status, JSON.stringify(res.body)).toBe(403);

    const inalterado = await prisma.announcement.findFirstOrThrow({
      where: { id },
      select: { title: true, editedAt: true },
    });
    expect(inalterado.title).toBe(`Aviso do colaborador ${SUFIXO}`);
    expect(inalterado.editedAt).toBeNull();
  });
});

describe("retirar o aviso do mural [S3-I]", () => {
  it("some para quem recebeu, fica marcado para quem cuida do mural", async () => {
    const id = await publicar(`Aviso a retirar ${SUFIXO}`);
    expect(await noMural(colaborador, id), "antes, está no mural").toBeTruthy();

    const res = await request(app)
      .post(`/api/announcements/${id}/retirar`)
      .set(as(rh))
      .send({ reason: `Data mudou ${SUFIXO}` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    expect(await noMural(colaborador, id), "sai do mural de quem o recebeu").toBeUndefined();
    const aberto = await request(app)
      .get(`/api/announcements/${id}`)
      .set(as(colaborador));
    expect(aberto.status, "nem pelo link direto").toBe(404);

    const paraQuemPublica = await noMural(rh, id);
    expect(paraQuemPublica, "o registro fica para quem cuida do mural").toBeTruthy();
    expect(paraQuemPublica?.withdrawnAt).toBeTruthy();
    expect(paraQuemPublica?.withdrawalReason).toBe(`Data mudou ${SUFIXO}`);
  });

  it("o sino deixa de apontar para o aviso retirado", async () => {
    const id = await publicar(`Aviso do sino ${SUFIXO}`);
    const antes = await prisma.notification.count({
      where: { entityType: "Announcement", entityId: id, readAt: null },
    });
    expect(antes, "publicar avisa o público").toBeGreaterThan(0);

    await request(app)
      .post(`/api/announcements/${id}/retirar`)
      .set(as(rh))
      .send({ reason: `Publicado por engano ${SUFIXO}` })
      .expect(200);

    const depois = await prisma.notification.count({
      where: { entityType: "Announcement", entityId: id, readAt: null },
    });
    expect(depois, "senão o sino levaria a uma tela que não abre").toBe(0);
  });

  it("retirar pede motivo, e não se retira duas vezes nem se corrige depois", async () => {
    const id = await publicar(`Aviso de motivo ${SUFIXO}`);
    await request(app)
      .post(`/api/announcements/${id}/retirar`)
      .set(as(rh))
      .send({ reason: "  " })
      .expect(400);

    await request(app)
      .post(`/api/announcements/${id}/retirar`)
      .set(as(rh))
      .send({ reason: `Motivo ${SUFIXO}` })
      .expect(200);

    const outraVez = await request(app)
      .post(`/api/announcements/${id}/retirar`)
      .set(as(rh))
      .send({ reason: `De novo ${SUFIXO}` });
    expect(outraVez.status).toBe(409);
    expect(outraVez.body.code).toBe("ALREADY_WITHDRAWN");

    const corrigir = await request(app)
      .patch(`/api/announcements/${id}`)
      .set(as(rh))
      .send({ title: `Depois de retirado ${SUFIXO}` });
    expect(corrigir.status).toBe(409);
    expect(corrigir.body.code).toBe("ALREADY_WITHDRAWN");
  });

  it("quem só lê o mural não retira nada", async () => {
    const id = await publicar(`Aviso protegido ${SUFIXO}`);
    const res = await request(app)
      .post(`/api/announcements/${id}/retirar`)
      .set(as(colaborador))
      .send({ reason: "quero tirar" });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(await noMural(colaborador, id), "continua no mural").toBeTruthy();
  });
});

describe("o procedimento de emergência nasce na unidade escolhida [CB-18]", () => {
  /*
    A correção de CB-18 é na tela — o seletor deixa de vir com a primeira
    unidade escolhida. Este caso é a rede embaixo: garante que, com o seletor
    vazio, nada é gravado sem unidade. A prova da tela em si é em navegador.
  */
  it("sem unidade, o servidor recusa — a tela não escolhe por ninguém", async () => {
    const sst = await entrar("teste.sst");
    const res = await request(app)
      .post("/api/emergency-procedures")
      .set(as(sst))
      .send({
        scenario: `Incêndio sem unidade ${SUFIXO}`,
        firstAidMeans: "Maleta",
        responsibles: "Brigada",
        evacuationPlan: "Ponto de encontro",
      });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.message, "recusado pela unidade, não por outro campo").toContain(
      "establishment_id",
    );
  });
});
