import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * As próprias denúncias identificadas, na conta de quem denunciou (desenho
 * de 13/11, item 11). Sem protocolo e código; a anônima nunca aparece.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`. Outra empresa, criada
 * aqui, guarda uma denúncia do mesmo colaborador para provar o recorte.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const EST_ID = "aaaaaaaa-0001-4000-8000-000000000011";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let master: { token: string; user: { id: string } };
let colaborador: { token: string; user: { id: string } };
let supervisor: { token: string; user: { id: string } };
const relatos: string[] = [];
let outraOrg = "";

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

async function denunciar(quem: { token: string } | null, identificada: boolean) {
  const req = request(app).post("/api/ethics-reports");
  if (quem) req.set(as(quem.token));
  const res = await req.send({
    organization_id: ORG_ID,
    establishment_id: EST_ID,
    category: "MISCONDUCT",
    description: `Relato da conta ${SUFIXO}, com mais de vinte caracteres.`,
    is_anonymous: !identificada,
    committee_involved: false,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  relatos.push(res.body.report.id);
  return {
    id: res.body.report.id as string,
    protocol: res.body.report.protocol as string,
    code: res.body.access_code as string,
  };
}

const minhas = async (quem: { token: string }) => {
  const res = await request(app).get("/api/ethics-reports/minhas").set(as(quem.token));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.reports as { id: string; unread: number; protocol: string }[];
};

let identificada: { id: string; protocol: string; code: string };
let anonimaDoColaborador: { id: string };
let doColega: { id: string };
let deOutraEmpresa = "";

beforeAll(async () => {
  app = createApp();
  master = await entrar("teste.master");
  colaborador = await entrar("teste.colaborador");
  supervisor = await entrar("teste.supervisor");
  await prisma.ethicsCommitteeMember.deleteMany({ where: { organizationId: ORG_ID } });

  identificada = await denunciar(colaborador, true);
  /* Anônima, mesmo enviada por quem está logado: não guarda vínculo. */
  anonimaDoColaborador = await denunciar(colaborador, false);
  doColega = await denunciar(supervisor, true);

  outraOrg = (await prisma.organization.create({ data: { name: `Outra DNC ${SUFIXO}` } })).id;
  deOutraEmpresa = (
    await prisma.ethicsReport.create({
      data: {
        organizationId: outraOrg,
        protocol: `CX-${SUFIXO.slice(-4)}`,
        category: "MISCONDUCT",
        description: "Denúncia da outra empresa, do mesmo colaborador.",
        isAnonymous: false,
        reporterUserId: colaborador.user.id,
        accessCodeHash: await bcrypt.hash("CODIGO", 4),
      },
    })
  ).id;
});

afterAll(async () => {
  const ids = [...relatos, deOutraEmpresa].filter(Boolean);
  await prisma.notification.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.ethicsReportMessage.deleteMany({ where: { reportId: { in: ids } } });
  await prisma.ethicsReport.deleteMany({ where: { id: { in: ids } } });
  if (outraOrg) await prisma.organization.deleteMany({ where: { id: outraOrg } });
});

describe("a lista das minhas denúncias", () => {
  it("traz só as identificadas da pessoa, nesta empresa", async () => {
    const ids = (await minhas(colaborador)).map((r) => r.id);
    expect(ids).toContain(identificada.id);
    expect(ids).not.toContain(anonimaDoColaborador.id);
    expect(ids).not.toContain(doColega.id);
    expect(ids).not.toContain(deOutraEmpresa);
  });

  it("anônima com a pessoa ligada por erro de dado também não aparece: a marca de anônima vale sozinha", async () => {
    const torta = await prisma.ethicsReport.create({
      data: {
        organizationId: ORG_ID,
        protocol: `CX-${SUFIXO.slice(-3)}9`,
        category: "MISCONDUCT",
        description: "Anônima com vínculo indevido, para o teste.",
        isAnonymous: true,
        reporterUserId: colaborador.user.id,
        accessCodeHash: await bcrypt.hash("CODIGO", 4),
      },
    });
    relatos.push(torta.id);
    expect((await minhas(colaborador)).map((r) => r.id)).not.toContain(torta.id);
    expect(
      (await request(app).get(`/api/ethics-reports/minhas/${torta.id}`).set(as(colaborador.token))).status,
    ).toBe(404);
  });

  it("não traz a descrição nem nada do comitê", async () => {
    const linha = (await minhas(colaborador)).find((r) => r.id === identificada.id)!;
    expect(Object.keys(linha).sort()).toEqual(
      ["category", "createdAt", "id", "protocol", "reporterAckAt", "status", "unread"].sort(),
    );
  });

  it("sem login, 401", async () => {
    expect((await request(app).get("/api/ethics-reports/minhas")).status).toBe(401);
  });

  it("quem é do comitê recebe as próprias em /minhas, não a lista do comitê", async () => {
    const doMaster = await denunciar(master, true);
    const lista = await minhas(master);
    expect(lista.map((r) => r.id)).toEqual(expect.arrayContaining([doMaster.id]));
    expect(lista.map((r) => r.id)).not.toContain(identificada.id);
    expect(lista.every((r) => "unread" in r)).toBe(true);
    /* E a rota do comitê, por id, continua do comitê. */
    expect((await request(app).get(`/api/ethics-reports/${identificada.id}`).set(as(master.token))).status).toBe(200);
  });
});

describe("o acompanhamento pela conta", () => {
  it("abre a própria; a anônima, a do colega e a de outra empresa dão o mesmo 404", async () => {
    const res = await request(app).get(`/api/ethics-reports/minhas/${identificada.id}`).set(as(colaborador.token));
    expect(res.status).toBe(200);
    expect(res.body.report.protocol).toBe(identificada.protocol);
    expect(res.body.report).not.toHaveProperty("accessCodeHash");
    for (const id of [anonimaDoColaborador.id, doColega.id, deOutraEmpresa]) {
      const fora = await request(app).get(`/api/ethics-reports/minhas/${id}`).set(as(colaborador.token));
      expect(fora.status, id).toBe(404);
      expect(fora.body.message, id).toBe("Denúncia não encontrada.");
    }
  });

  it("a resposta do comitê avisa com o link da conta, conta como não lida e é lida ao abrir", async () => {
    const msg = await request(app)
      .post(`/api/ethics-reports/${identificada.id}/messages`)
      .set(as(master.token))
      .send({ body: "Pode contar quando aconteceu?" });
    expect(msg.status, JSON.stringify(msg.body)).toBe(201);
    const aviso = await prisma.notification.findFirst({
      where: { entityId: identificada.id, kind: "ETHICS_MESSAGE" },
    });
    expect(aviso?.userId).toBe(colaborador.user.id);
    expect(aviso?.link).toBe(`/denuncia?minha=${identificada.id}`);

    expect((await minhas(colaborador)).find((r) => r.id === identificada.id)!.unread).toBe(1);
    const aberta = await request(app).get(`/api/ethics-reports/minhas/${identificada.id}`).set(as(colaborador.token));
    expect(aberta.body.report.messages.map((m: { body: string }) => m.body)).toContain("Pode contar quando aconteceu?");
    expect((await minhas(colaborador)).find((r) => r.id === identificada.id)!.unread).toBe(0);
  });

  it("a pessoa responde sem código; a mensagem não guarda o autor, e o comitê a vê", async () => {
    const res = await request(app)
      .post(`/api/ethics-reports/minhas/${identificada.id}/mensagens`)
      .set(as(colaborador.token))
      .send({ body: "Foi na terça, no estoque." });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const gravada = await prisma.ethicsReportMessage.findUniqueOrThrow({ where: { id: res.body.message.id } });
    expect(gravada.authorUserId).toBeNull();
    expect(gravada.side).toBe("REPORTER");
    const doComite = await request(app).get(`/api/ethics-reports/${identificada.id}`).set(as(master.token));
    expect(JSON.stringify(doComite.body)).toContain("Foi na terça, no estoque.");
    /* Na do colega, nada. */
    const fora = await request(app)
      .post(`/api/ethics-reports/minhas/${doColega.id}/mensagens`)
      .set(as(colaborador.token))
      .send({ body: "x" });
    expect(fora.status).toBe(404);
  });

  it("a ciência do encerramento pela conta: uma vez, sem autor na trilha", async () => {
    const encerra = await request(app)
      .patch(`/api/ethics-reports/${identificada.id}`)
      .set(as(master.token))
      .send({ status: "RESOLVED", resolution_note: "Apurado e tratado." });
    expect(encerra.status, JSON.stringify(encerra.body)).toBe(200);
    const fechou = await prisma.notification.findFirst({
      where: { entityId: identificada.id, kind: "ETHICS_REPORT_CLOSED" },
    });
    expect(fechou?.link).toBe(`/denuncia?minha=${identificada.id}`);
    expect(fechou?.body).not.toMatch(/código/);

    const ciencia = () =>
      request(app)
        .post(`/api/ethics-reports/minhas/${identificada.id}/ciencia`)
        .set(as(colaborador.token))
        .send({ comment: "Li." });
    expect((await ciencia()).status).toBe(200);
    expect((await ciencia()).status).toBe(409);
    const trilha = await prisma.auditEvent.findFirstOrThrow({
      where: { entityId: identificada.id, action: "ethics_report.acknowledge" },
    });
    expect(trilha.actorId).toBeNull();
    expect(
      (await request(app).post(`/api/ethics-reports/minhas/${doColega.id}/ciencia`).set(as(colaborador.token)).send({})).status,
    ).toBe(404);
  });

  it("o caminho por protocolo e código continua", async () => {
    const res = await request(app)
      .post("/api/ethics-reports/track")
      .send({ protocol: identificada.protocol, access_code: identificada.code });
    expect(res.status).toBe(200);
    expect(res.body.report.id).toBe(identificada.id);
  });
});
