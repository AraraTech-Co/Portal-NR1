import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O canal de denúncia fora do portal.
 *
 * O anonimato sempre existiu de verdade no banco, mas quem denunciava
 * entrava com usuário e senha e não tinha como saber disso. Agora o canal é
 * público: sem sessão nenhuma [S4-L]. E a lista do comitê passa a trazer o
 * começo do relato e a dizer quem nunca teve resposta, que foi o que levou a
 * pergunta a ir para a denúncia errada [B2-3-D].
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: { token: string; user: { id: string } };
const relatos: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

/** Sem cabeçalho de autorização: é exatamente o ponto. */
const semSessao = () => request(app);

beforeAll(async () => {
  app = createApp();
  rh = await entrar("teste.rh");
});

afterAll(async () => {
  await prisma.ethicsReport.deleteMany({ where: { id: { in: relatos } } });
});

describe("denunciar sem login [S4-L]", () => {
  it("o canal diz de que empresa é antes de alguém escrever", async () => {
    const res = await semSessao().get(
      `/api/ethics-reports/meta?organization_id=${ORG_ID}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.organization?.id).toBe(ORG_ID);
    expect(res.body.organization?.name).toBeTruthy();
    expect(Array.isArray(res.body.categories)).toBe(true);
  });

  it("link de empresa que não existe não revela nada", async () => {
    const res = await semSessao().get(
      "/api/ethics-reports/meta?organization_id=00000000-0000-4000-8000-00000000dead",
    );
    expect(res.status).toBe(200);
    expect(res.body.organization, "sem empresa, sem nome").toBeNull();
  });

  it("a denúncia entra sem sessão, e o banco não guarda quem enviou", async () => {
    const res = await semSessao()
      .post("/api/ethics-reports")
      .send({
        organization_id: ORG_ID,
        category: "HARASSMENT_MORAL",
        description: `Relato enviado de fora do portal ${SUFIXO}, sem login nenhum.`,
        is_anonymous: true,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    relatos.push(res.body.report.id);

    expect(res.body.report.protocol).toBeTruthy();
    expect(res.body.access_code, "o código só existe aqui, uma vez").toBeTruthy();

    const guardado = await prisma.ethicsReport.findFirstOrThrow({
      where: { id: res.body.report.id },
      select: { reporterUserId: true, isAnonymous: true, organizationId: true },
    });
    expect(guardado.isAnonymous).toBe(true);
    expect(guardado.reporterUserId, "não existe vínculo com pessoa").toBeNull();
    expect(guardado.organizationId).toBe(ORG_ID);
  });

  it("quem denunciou acompanha pelo protocolo e código, também sem login", async () => {
    const criado = await semSessao()
      .post("/api/ethics-reports")
      .send({
        organization_id: ORG_ID,
        category: "SAFETY_RISK",
        description: `Acompanhamento de fora ${SUFIXO}, sem login.`,
        is_anonymous: true,
      });
    expect(criado.status).toBe(201);
    relatos.push(criado.body.report.id);

    const acompanha = await semSessao()
      .post("/api/ethics-reports/track")
      .send({
        protocol: criado.body.report.protocol,
        access_code: criado.body.access_code,
      });
    expect(acompanha.status, JSON.stringify(acompanha.body)).toBe(200);
    expect(acompanha.body.report.protocol).toBe(criado.body.report.protocol);

    const codigoErrado = await semSessao()
      .post("/api/ethics-reports/track")
      .send({ protocol: criado.body.report.protocol, access_code: "errado" });
    expect(codigoErrado.status).not.toBe(200);
  });

  it("a denúncia sem empresa é recusada", async () => {
    const res = await semSessao()
      .post("/api/ethics-reports")
      .send({
        category: "SAFETY_RISK",
        description: `Sem empresa ${SUFIXO}, não dá para saber de quem é.`,
        is_anonymous: true,
      });
    expect(res.status).toBe(400);
  });

  it("ler a lista do comitê continua exigindo sessão", async () => {
    const res = await semSessao().get("/api/ethics-reports");
    expect(res.status).toBe(401);
  });
});

describe("a lista do comitê distingue uma denúncia da outra [B2-3-D]", () => {
  it("traz o relato e diz quem nunca teve resposta", async () => {
    const criado = await semSessao()
      .post("/api/ethics-reports")
      .send({
        organization_id: ORG_ID,
        category: "SAFETY_RISK",
        description: `Texto que identifica este relato ${SUFIXO} e mais nenhum outro.`,
        is_anonymous: true,
      });
    expect(criado.status).toBe(201);
    relatos.push(criado.body.report.id);

    const lista = await request(app).get("/api/ethics-reports").set(as(rh.token));
    expect(lista.status).toBe(200);
    const linha = (lista.body.reports as {
      id: string;
      description: string;
      committee_messages: number;
    }[]).find((r) => r.id === criado.body.report.id);
    expect(linha?.description, "a lista mostra do que se trata").toContain(SUFIXO);
    expect(linha?.committee_messages, "ninguém respondeu ainda").toBe(0);

    // O comitê fala: deixa de estar sem resposta.
    const resposta = await request(app)
      .post(`/api/ethics-reports/${criado.body.report.id}/messages`)
      .set(as(rh.token))
      .send({ body: `Recebemos o seu relato ${SUFIXO}.` });
    expect(resposta.status, JSON.stringify(resposta.body)).toBe(201);

    const depois = await request(app).get("/api/ethics-reports").set(as(rh.token));
    const agora = (depois.body.reports as {
      id: string;
      committee_messages: number;
    }[]).find((r) => r.id === criado.body.report.id);
    expect(agora?.committee_messages).toBe(1);
  });
});
