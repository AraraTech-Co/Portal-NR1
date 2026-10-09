import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";

/**
 * O responsável prova o que fez e conclui a própria ação; quem executou não
 * valida. [S3-C] [S3-M]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
const PRAZO = "2026-12-20";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function entrar(app: Express, login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let sst: { token: string; user: { id: string } };
let supervisor: { token: string; user: { id: string } };
let colaborador: { token: string; user: { id: string } };
let gerente: { token: string; user: { id: string } };

/** Ação aberta no nome de quem for indicado. */
async function novaAcao(assigneeId: string, title: string) {
  const res = await request(app)
    .post("/api/actions")
    .set(as(sst.token))
    .send({ title: `${title} ${SUFIXO}`, assignee_id: assigneeId, due_date: PRAZO, priority: "HIGH" });
  expect(res.status).toBe(201);
  return res.body.action.id as string;
}

const anexar = (token: string, actionId: string) =>
  request(app)
    .post("/api/evidences")
    .set(as(token))
    .send({
      action_id: actionId,
      type: "PHOTO",
      file_name: "feito.png",
      mime_type: "image/png",
      content_base64: PNG.toString("base64"),
      description: "Serviço concluído",
    });

beforeAll(async () => {
  app = createApp();
  sst = await entrar(app, "teste.sst");
  supervisor = await entrar(app, "teste.supervisor");
  colaborador = await entrar(app, "teste.colaborador");
  gerente = await entrar(app, "teste.gerente");
});

describe("o responsável executa [S3-C]", () => {
  it("anexa a foto e conclui a própria ação", async () => {
    const id = await novaAcao(supervisor.user.id, "Instalar corrimão");

    const semProva = await request(app).post(`/api/actions/${id}/complete`).set(as(supervisor.token));
    expect(semProva.status).toBe(400);
    expect(semProva.body.message).toMatch(/evidência/i);

    expect((await anexar(supervisor.token, id)).status).toBe(201);

    const ok = await request(app).post(`/api/actions/${id}/complete`).set(as(supervisor.token));
    expect(ok.status).toBe(200);
    expect(ok.body.action.status).toBe("WAITING_VALIDATION");
  });

  it("o responsável que só lê o plano também prova e conclui", async () => {
    const id = await novaAcao(colaborador.user.id, "Guardar a escada");
    expect((await anexar(colaborador.token, id)).status).toBe(201);
    const ok = await request(app).post(`/api/actions/${id}/complete`).set(as(colaborador.token));
    expect(ok.status).toBe(200);
    expect(ok.body.action.status).toBe("WAITING_VALIDATION");
  });

  it("quem não é o responsável não conclui, mesmo mandando no plano [S3-M]", async () => {
    const id = await novaAcao(supervisor.user.id, "Trocar a lâmpada");
    await anexar(supervisor.token, id);

    for (const quem of [sst, gerente]) {
      const res = await request(app).post(`/api/actions/${id}/complete`).set(as(quem.token));
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/respons/i);
    }
  });

  it("quem não é responsável nem cuida do plano não anexa evidência", async () => {
    const id = await novaAcao(supervisor.user.id, "Pintar a faixa");
    const res = await anexar(colaborador.token, id);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/respons/i);
  });

  it("quem executou não valida; outra pessoa valida vendo a prova", async () => {
    const id = await novaAcao(supervisor.user.id, "Fixar a prateleira");
    await anexar(supervisor.token, id);
    await request(app).post(`/api/actions/${id}/complete`).set(as(supervisor.token));

    const proprio = await request(app)
      .post(`/api/actions/${id}/review`)
      .set(as(supervisor.token))
      .send({ decision: "approve" });
    expect(proprio.status).toBe(403);

    const outro = await request(app)
      .post(`/api/actions/${id}/review`)
      .set(as(sst.token))
      .send({ decision: "approve", effectiveness_result: "Prateleira firme na foto" });
    expect(outro.status).toBe(200);
    expect(outro.body.action.status).toBe("VALIDATED");
  });

  it("ação encerrada não recebe mais evidência", async () => {
    const id = await novaAcao(supervisor.user.id, "Sinalizar o piso");
    await anexar(supervisor.token, id);
    await request(app).post(`/api/actions/${id}/complete`).set(as(supervisor.token));
    await request(app)
      .post(`/api/actions/${id}/review`)
      .set(as(sst.token))
      .send({ decision: "approve" });

    const res = await anexar(supervisor.token, id);
    expect(res.status).toBe(409);
  });
});
