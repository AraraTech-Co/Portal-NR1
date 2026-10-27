import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";

/**
 * Quem valida a ação do plano.
 *
 * Validava qualquer pessoa com escrita no Plano de ação que não fosse o
 * executor — pela matriz, isso inclui supervisor, gerente e ADM de loja, e
 * com isso um supervisor validava a ação de outro supervisor. Quem afere se
 * a medida funcionou passa a ser quem responde tecnicamente: SST, dono da
 * conta ou master da empresa. Decidido em 20/10/2026, revendo a decisão de
 * 18/10/2026. [OB-6]
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

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let sst: { token: string; user: { id: string } };
let supervisor: { token: string; user: { id: string } };
let gerente: { token: string; user: { id: string } };
let admLoja: { token: string; user: { id: string } };
let colaborador: { token: string; user: { id: string } };

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

/** Uma ação já concluída pelo responsável, esperando validação. */
async function acaoEsperandoValidacao(assignee: { token: string; user: { id: string } }, titulo: string) {
  const criada = await request(app)
    .post("/api/actions")
    .set(as(sst.token))
    .send({
      effectiveness_criteria: "Critério do teste",
      title: `${titulo} ${SUFIXO}`,
      assignee_id: assignee.user.id,
      due_date: PRAZO,
      priority: "HIGH",
    });
  expect(criada.status, JSON.stringify(criada.body)).toBe(201);
  const id = criada.body.action.id as string;

  const prova = await request(app)
    .post("/api/evidences")
    .set(as(assignee.token))
    .send({
      action_id: id,
      type: "PHOTO",
      file_name: "feito.png",
      mime_type: "image/png",
      content_base64: PNG.toString("base64"),
      description: "Serviço concluído",
    });
  expect(prova.status, JSON.stringify(prova.body)).toBe(201);

  const concluida = await request(app)
    .post(`/api/actions/${id}/complete`)
    .set(as(assignee.token));
  expect(concluida.status, JSON.stringify(concluida.body)).toBe(200);
  expect(concluida.body.action.status).toBe("WAITING_VALIDATION");
  return id;
}

async function situacao(id: string) {
  const res = await request(app).get("/api/actions").set(as(sst.token));
  expect(res.status).toBe(200);
  const acao = (res.body.actions as { id: string; status: string }[]).find(
    (a) => a.id === id,
  );
  return acao?.status;
}

beforeAll(async () => {
  app = createApp();
  sst = await entrar("teste.sst");
  supervisor = await entrar("teste.supervisor");
  gerente = await entrar("teste.gerente");
  admLoja = await entrar("teste.admloja");
  colaborador = await entrar("teste.colaborador");
});

describe("validar a ação é de quem responde tecnicamente [OB-6]", () => {
  it("o SST valida e a ação fica validada", async () => {
    const id = await acaoEsperandoValidacao(supervisor, "Sinalizar o piso");
    const res = await request(app)
      .post(`/api/actions/${id}/review`)
      .set(as(sst.token))
      .send({ decision: "approve", effectiveness_result: `Conferido ${SUFIXO}` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await situacao(id)).toBe("VALIDATED");
  });

  it("supervisor, gerente e ADM de loja escrevem no plano, mas não validam", async () => {
    for (const [nome, quem] of [
      ["supervisor", supervisor],
      ["gerente", gerente],
      ["ADM de loja", admLoja],
    ] as const) {
      /*
        O executor é o colaborador, para que a recusa venha do papel de quem
        valida e não da regra antiga de "quem executou não valida".
      */
      const id = await acaoEsperandoValidacao(colaborador, `Fixar a prateleira ${nome}`);
      const res = await request(app)
        .post(`/api/actions/${id}/review`)
        .set(as(quem.token))
        .send({ decision: "approve", effectiveness_result: "Parece bom" });
      expect(res.status, `${nome}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body.code, nome).toBe("NOT_A_VALIDATOR");
      expect(await situacao(id), `${nome}: a ação não se mexe`).toBe(
        "WAITING_VALIDATION",
      );
    }
  });

  it("recusar a evidência também é só de quem valida", async () => {
    const id = await acaoEsperandoValidacao(colaborador, "Guardar a escada");
    const negada = await request(app)
      .post(`/api/actions/${id}/review`)
      .set(as(supervisor.token))
      .send({ decision: "reject", rejection_reason: "Foto ruim" });
    expect(negada.status, JSON.stringify(negada.body)).toBe(403);
    expect(await situacao(id)).toBe("WAITING_VALIDATION");

    const peloSst = await request(app)
      .post(`/api/actions/${id}/review`)
      .set(as(sst.token))
      .send({ decision: "reject", rejection_reason: `Foto ruim ${SUFIXO}` });
    expect(peloSst.status, JSON.stringify(peloSst.body)).toBe(200);
  });

  it("quem executou continua sem validar, mesmo sendo quem valida", async () => {
    const id = await acaoEsperandoValidacao(sst, "Instalar corrimão");
    const res = await request(app)
      .post(`/api/actions/${id}/review`)
      .set(as(sst.token))
      .send({ decision: "approve", effectiveness_result: "Eu mesmo conferi" });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.message, "é a regra antiga, não a nova").toMatch(/executou/i);
    expect(await situacao(id)).toBe("WAITING_VALIDATION");
  });
});
