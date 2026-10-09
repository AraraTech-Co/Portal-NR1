import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";

/**
 * Escrever para enviar o PRÓPRIO registro não é administrar o módulo.
 * Mesma causa do [S4-A] em ideias, clima, ocorrências e AEP.
 *
 * Exige a organização do `scripts/seed-teste-org.ts` (um usuário por papel).
 */
const SENHA = "teste1234";
const EST_ID = "aaaaaaaa-0001-4000-8000-000000000011";
const SECTOR_ID = "aaaaaaaa-0001-4000-8000-000000000012";
const ACT_ID = "aaaaaaaa-0001-4000-8000-000000000014";

async function entrar(app: Express, login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

let app: Express;
let colaborador: { token: string; user: { id: string } };
let rh: { token: string; user: { id: string } };
let sst: { token: string; user: { id: string } };

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  app = createApp();
  colaborador = await entrar(app, "teste.colaborador");
  rh = await entrar(app, "teste.rh");
  sst = await entrar(app, "teste.sst");
});

describe("ideias", () => {
  it("o colaborador vê só as próprias e não decide nenhuma", async () => {
    const doRh = await request(app)
      .post("/api/ideas")
      .set(as(rh.token))
      .send({ title: "Ideia do RH", description: "Texto da ideia do RH" });
    expect(doRh.status).toBe(201);
    const minha = await request(app)
      .post("/api/ideas")
      .set(as(colaborador.token))
      .send({ title: "Minha ideia", description: "Texto da minha ideia" });
    expect(minha.status).toBe(201);

    const lista = await request(app).get("/api/ideas").set(as(colaborador.token));
    const autores = new Set(
      (lista.body.ideas as { authorUserId: string }[]).map((i) => i.authorUserId),
    );
    expect([...autores]).toEqual([colaborador.user.id]);

    const outra = await request(app)
      .get(`/api/ideas/${doRh.body.idea.id}`)
      .set(as(colaborador.token));
    expect(outra.status).toBe(403);

    const decide = await request(app)
      .post(`/api/ideas/${minha.body.idea.id}/decide`)
      .set(as(colaborador.token))
      .send({ status: "IN_ANALYSIS" });
    expect(decide.status).toBe(403);
  });

  it("o RH vê todas e decide", async () => {
    const minha = await request(app)
      .post("/api/ideas")
      .set(as(colaborador.token))
      .send({ title: "Para o RH decidir", description: "Texto da ideia" });
    const decide = await request(app)
      .post(`/api/ideas/${minha.body.idea.id}/decide`)
      .set(as(rh.token))
      .send({ status: "IN_ANALYSIS" });
    expect(decide.status).toBe(200);
  });
});

describe("clima", () => {
  it("o colaborador não monta, não abre e não vê rascunho; o RH sim", async () => {
    const tentativa = await request(app)
      .post("/api/climate-surveys")
      .set(as(colaborador.token))
      .send({ title: "Pesquisa paralela", questions: [{ prompt: "Pergunta?" }] });
    expect(tentativa.status).toBe(403);

    const criada = await request(app)
      .post("/api/climate-surveys")
      .set(as(rh.token))
      .send({ title: "Clima do RH", questions: [{ prompt: "Você se sente ouvido?" }] });
    expect(criada.status).toBe(201);
    const id = criada.body.survey.id as string;

    const rascunho = await request(app)
      .get(`/api/climate-surveys/${id}`)
      .set(as(colaborador.token));
    expect(rascunho.status).toBe(404);

    const abrir = await request(app)
      .post(`/api/climate-surveys/${id}/open`)
      .set(as(colaborador.token));
    expect(abrir.status).toBe(403);

    const abrirRh = await request(app)
      .post(`/api/climate-surveys/${id}/open`)
      .set(as(rh.token));
    expect(abrirRh.status).toBe(200);

    const aberta = await request(app)
      .get(`/api/climate-surveys/${id}`)
      .set(as(colaborador.token));
    expect(aberta.status).toBe(200);
    const qid = aberta.body.survey.questions[0].id as string;

    const responde = await request(app)
      .post(`/api/climate-surveys/${id}/respond`)
      .set(as(colaborador.token))
      .send({ answers: [{ question_id: qid, score: 4 }] });
    expect(responde.status).toBe(201);

    const fechar = await request(app)
      .post(`/api/climate-surveys/${id}/close`)
      .set(as(colaborador.token));
    expect(fechar.status).toBe(403);
  });
});

describe("ocorrências", () => {
  async function registrar(token: string, description: string) {
    const res = await request(app)
      .post("/api/occurrences")
      .set(as(token))
      .send({
        type: "DANGEROUS_EVENT",
        description,
        occurred_at: "2026-10-05T10:00:00.000Z",
        establishment_id: EST_ID,
      });
    expect(res.status).toBe(201);
    return res.body.occurrence.id as string;
  }

  it("o colaborador registra e corrige a própria, mas não mexe na dos outros", async () => {
    const minha = await registrar(colaborador.token, "Piso molhado no corredor");
    const corrige = await request(app)
      .patch(`/api/occurrences/${minha}`)
      .set(as(colaborador.token))
      .send({ description: "Piso molhado no corredor da expedição" });
    expect(corrige.status).toBe(200);

    const doSst = await registrar(sst.token, "Registro do técnico");
    const mexe = await request(app)
      .patch(`/api/occurrences/${doSst}`)
      .set(as(colaborador.token))
      .send({ description: "Alterado por outra pessoa" });
    expect(mexe.status).toBe(403);
  });

  it("analisar e abrir ação é de quem administra", async () => {
    const minha = await registrar(colaborador.token, "Caixa caiu da prateleira");
    const analise = {
      generating_situation: "Prateleira sem trava",
      organizational_data: "Turno da tarde",
      prevention_review: "Instalar trava",
    };

    const analisa = await request(app)
      .post(`/api/occurrences/${minha}/analyze`)
      .set(as(colaborador.token))
      .send(analise);
    expect(analisa.status).toBe(403);

    const acao = await request(app)
      .post(`/api/occurrences/${minha}/actions`)
      .set(as(colaborador.token))
      .send({ title: "Instalar trava" });
    expect(acao.status).toBe(403);

    const analisaSst = await request(app)
      .post(`/api/occurrences/${minha}/analyze`)
      .set(as(sst.token))
      .send(analise);
    expect(analisaSst.status).toBe(200);
  });
});

describe("AEP", () => {
  async function criar(token: string) {
    const res = await request(app)
      .post("/api/aeps")
      .set(as(token))
      .send({
        establishment_id: EST_ID,
        sector_id: SECTOR_ID,
        activity_id: ACT_ID,
        scope_description: "Atendimento no caixa",
        method: "OBSERVATION",
      });
    expect(res.status).toBe(201);
    return res.body.aep.id as string;
  }

  it("o colaborador não edita a avaliação de outro, não conclui e não leva perigo ao inventário", async () => {
    const doSst = await criar(sst.token);

    const edita = await request(app)
      .patch(`/api/aeps/${doSst}`)
      .set(as(colaborador.token))
      .send({ findings: "Alterado por outra pessoa" });
    expect(edita.status).toBe(403);

    const perigo = await request(app)
      .post(`/api/aeps/${doSst}/hazards`)
      .set(as(colaborador.token))
      .send({ factor_id: "OVERLOAD", description: "Sobrecarga", exposed_workers_count: 2 });
    expect(perigo.status).toBe(403);

    const conclui = await request(app)
      .post(`/api/aeps/${doSst}/conclude`)
      .set(as(colaborador.token))
      .send({ needs_aet: false });
    expect(conclui.status).toBe(403);
  });

  it("o técnico de SST continua fazendo tudo isso", async () => {
    const doSst = await criar(sst.token);
    const perigo = await request(app)
      .post(`/api/aeps/${doSst}/hazards`)
      .set(as(sst.token))
      .send({ factor_id: "OVERLOAD", description: "Sobrecarga", exposed_workers_count: 2 });
    expect(perigo.status).toBe(201);
  });
});
