import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Comitê de ética designado, e quem a denúncia envolve sai do caso.
 *
 * Antes, "comitê" era quem tivesse o módulo na matriz — na prática o RH
 * inteiro. Uma denúncia contra alguém do RH chegava à mesa dele, e ele mesmo
 * respondia e encerrava. Agora a empresa designa quem é o comitê, e quem a
 * denúncia envolve perde o acesso àquele caso: não o vê na lista, não o abre,
 * não responde e não encerra. [CB-27]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let master: { token: string; user: { id: string } };
let rh: { token: string; user: { id: string } };
let sst: { token: string; user: { id: string } };
const relatos: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

/** Uma denúncia nova, pelo canal, sem sessão. */
async function denunciar(descricao: string): Promise<string> {
  const res = await request(app).post("/api/ethics-reports").send({
    organization_id: ORG_ID,
    category: "HARASSMENT_MORAL",
    description: descricao,
    is_anonymous: true,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  relatos.push(res.body.report.id);
  return res.body.report.id as string;
}

beforeAll(async () => {
  app = createApp();
  master = await entrar("teste.master");
  rh = await entrar("teste.rh");
  sst = await entrar("teste.sst");
  await prisma.ethicsCommitteeMember.deleteMany({ where: { organizationId: ORG_ID } });
});

afterAll(async () => {
  /*
    O comitê designado é estado da empresa: sai daqui como entrou, senão os
    outros arquivos de teste deixam de ver as denúncias.
  */
  await prisma.ethicsCommitteeMember.deleteMany({ where: { organizationId: ORG_ID } });
  await prisma.ethicsReportCited.deleteMany({ where: { reportId: { in: relatos } } });
  await prisma.ethicsReport.deleteMany({ where: { id: { in: relatos } } });
});

describe("designar o comitê [CB-27]", () => {
  it("sem ninguém designado, vale a regra antiga e a tela diz isso", async () => {
    const quadro = await request(app).get("/api/ethics-committee").set(as(rh.token));
    expect(quadro.status, JSON.stringify(quadro.body)).toBe(200);
    expect(quadro.body.members).toEqual([]);
    expect(quadro.body.falling_back).toBe(true);
    expect(quadro.body.people.length).toBeGreaterThan(0);

    const lista = await request(app).get("/api/ethics-reports").set(as(rh.token));
    expect(lista.status, JSON.stringify(lista.body)).toBe(200);
  });

  it("quem não cuida da conta não designa comitê", async () => {
    const res = await request(app)
      .post("/api/ethics-committee")
      .set(as(sst.token))
      .send({ user_id: sst.user.id, member: true });
    expect(res.status).toBe(403);
  });

  it("designar alguém de fora da empresa é recusado", async () => {
    const res = await request(app)
      .post("/api/ethics-committee")
      .set(as(master.token))
      .send({ user_id: "00000000-0000-4000-8000-00000000dead", member: true });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  it("designado o primeiro, quem está fora da lista perde as denúncias", async () => {
    const designar = await request(app)
      .post("/api/ethics-committee")
      .set(as(master.token))
      .send({ user_id: master.user.id, member: true });
    expect(designar.status, JSON.stringify(designar.body)).toBe(200);

    const quadro = await request(app).get("/api/ethics-committee").set(as(master.token));
    expect(quadro.body.falling_back).toBe(false);
    expect(quadro.body.members.map((m: { userId: string }) => m.userId)).toEqual([
      master.user.id,
    ]);

    // O RH tem o módulo na matriz, mas não foi designado.
    const doRh = await request(app).get("/api/ethics-reports").set(as(rh.token));
    expect(doRh.status, JSON.stringify(doRh.body)).toBe(403);

    const doMaster = await request(app).get("/api/ethics-reports").set(as(master.token));
    expect(doMaster.status, JSON.stringify(doMaster.body)).toBe(200);
  });

  it("tirar do comitê devolve o acesso à regra antiga", async () => {
    const tirar = await request(app)
      .post("/api/ethics-committee")
      .set(as(master.token))
      .send({ user_id: master.user.id, member: false });
    expect(tirar.status, JSON.stringify(tirar.body)).toBe(200);

    const doRh = await request(app).get("/api/ethics-reports").set(as(rh.token));
    expect(doRh.status, JSON.stringify(doRh.body)).toBe(200);
  });
});

describe("quem a denúncia envolve sai do caso [CB-27]", () => {
  let relatoId = "";

  beforeAll(async () => {
    relatoId = await denunciar(
      "Relato de teste automatizado sobre conduta de uma pessoa do comitê.",
    );
    for (const quem of [master.user.id, rh.user.id]) {
      const res = await request(app)
        .post("/api/ethics-committee")
        .set(as(master.token))
        .send({ user_id: quem, member: true });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
  });

  it("os dois do comitê veem o relato antes de qualquer marcação", async () => {
    for (const quem of [master, rh]) {
      const res = await request(app).get("/api/ethics-reports").set(as(quem.token));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ids = res.body.reports.map((r: { id: string }) => r.id);
      expect(ids).toContain(relatoId);
    }
  });

  it("marcar a si mesmo é recusado, com motivo", async () => {
    const res = await request(app)
      .post(`/api/ethics-reports/${relatoId}/citados`)
      .set(as(master.token))
      .send({ user_id: master.user.id, cited: true });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.code).toBe("CITED_SELF");
  });

  it("marcado, o citado não vê o relato na lista", async () => {
    const marcar = await request(app)
      .post(`/api/ethics-reports/${relatoId}/citados`)
      .set(as(master.token))
      .send({ user_id: rh.user.id, cited: true });
    expect(marcar.status, JSON.stringify(marcar.body)).toBe(200);

    const doRh = await request(app).get("/api/ethics-reports").set(as(rh.token));
    expect(doRh.status, JSON.stringify(doRh.body)).toBe(200);
    const ids = doRh.body.reports.map((r: { id: string }) => r.id);
    expect(ids).not.toContain(relatoId);

    // Para quem não é citado, segue na lista.
    const doMaster = await request(app).get("/api/ethics-reports").set(as(master.token));
    const idsMaster = doMaster.body.reports.map((r: { id: string }) => r.id);
    expect(idsMaster).toContain(relatoId);
  });

  it("o citado não abre, não responde e não encerra — e não sabe que existe", async () => {
    const abrir = await request(app)
      .get(`/api/ethics-reports/${relatoId}`)
      .set(as(rh.token));
    // 404 e não 403: não confirma o caso a quem está fora dele.
    expect(abrir.status, JSON.stringify(abrir.body)).toBe(404);

    const responder = await request(app)
      .post(`/api/ethics-reports/${relatoId}/messages`)
      .set(as(rh.token))
      .send({ body: "Resposta de quem é parte no caso." });
    expect(responder.status, JSON.stringify(responder.body)).toBe(404);

    const encerrar = await request(app)
      .patch(`/api/ethics-reports/${relatoId}`)
      .set(as(rh.token))
      .send({ status: "RESOLVED", resolution_note: "Encerrado por quem é parte." });
    expect(encerrar.status, JSON.stringify(encerrar.body)).toBe(404);

    const marcarOutro = await request(app)
      .post(`/api/ethics-reports/${relatoId}/citados`)
      .set(as(rh.token))
      .send({ user_id: master.user.id, cited: true });
    expect(marcarOutro.status, JSON.stringify(marcarOutro.body)).toBe(404);

    // Nada foi gravado pelo caminho de quem é parte.
    const depois = await prisma.ethicsReport.findUnique({
      where: { id: relatoId },
      select: { status: true, _count: { select: { messages: true, cited: true } } },
    });
    expect(depois?.status).toBe("RECEIVED");
    expect(depois?._count.messages).toBe(0);
    expect(depois?._count.cited).toBe(1);
  });

  it("quem continua no caso vê quem foi marcado, e por quem", async () => {
    const res = await request(app)
      .get(`/api/ethics-reports/${relatoId}`)
      .set(as(master.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.report.cited).toHaveLength(1);
    expect(res.body.report.cited[0].user.id).toBe(rh.user.id);
    expect(res.body.report.cited[0].markedBy.id).toBe(master.user.id);
  });

  it("a marcação vale só naquele caso", async () => {
    const outro = await denunciar("Outro relato de teste, sem ninguém marcado.");
    const doRh = await request(app).get("/api/ethics-reports").set(as(rh.token));
    const ids = doRh.body.reports.map((r: { id: string }) => r.id);
    expect(ids).toContain(outro);
    expect(ids).not.toContain(relatoId);

    const abrir = await request(app)
      .get(`/api/ethics-reports/${outro}`)
      .set(as(rh.token));
    expect(abrir.status, JSON.stringify(abrir.body)).toBe(200);
  });

  it("desmarcar devolve o caso à pessoa", async () => {
    const desmarcar = await request(app)
      .post(`/api/ethics-reports/${relatoId}/citados`)
      .set(as(master.token))
      .send({ user_id: rh.user.id, cited: false });
    expect(desmarcar.status, JSON.stringify(desmarcar.body)).toBe(200);

    const abrir = await request(app)
      .get(`/api/ethics-reports/${relatoId}`)
      .set(as(rh.token));
    expect(abrir.status, JSON.stringify(abrir.body)).toBe(200);
    expect(abrir.body.report.cited).toEqual([]);
  });

  it("a lista de nomes para marcar não exige ler Colaboradores", async () => {
    const res = await request(app)
      .get("/api/ethics-reports/pessoas")
      .set(as(master.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ids = res.body.people.map((p: { id: string }) => p.id);
    expect(ids).toContain(rh.user.id);
    // Só id, nome e se tem acesso: nada de CPF, salário ou ficha.
    expect(Object.keys(res.body.people[0]).sort()).toEqual(["active", "id", "name"]);
  });

  it("quem não é do comitê não lê a lista de nomes", async () => {
    const res = await request(app)
      .get("/api/ethics-reports/pessoas")
      .set(as(sst.token));
    expect(res.status).toBe(403);
  });
});
