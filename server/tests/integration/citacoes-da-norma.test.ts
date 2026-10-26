import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";

/**
 * O que o portal diz que a norma pede bate com o texto da norma.
 *
 * A ordem de serviço citava 1.4.1 "b" (informar riscos) no lugar de 1.4.1
 * "c" (elaborar ordens de serviço, dando ciência); a Participação citava
 * 1.5.3.2 (o que a organização faz no GRO) no lugar de 1.5.3.3 (consultar e
 * comunicar os trabalhadores); e o cartão de treinamento citava 1.5.5.5
 * (análise de acidentes) no lugar de 1.7.1 e 1.7.1.1 (capacitação e
 * certificado). Conferido no texto oficial, atualizado até a Portaria MTE
 * 765/2025. [B3-4-I]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const SENHA = "teste1234";
const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let sst = "";

async function cartoes() {
  const res = await request(app).get("/api/fiscalizacao").set(as(sst));
  expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
  return res.body.checks as { id: string; requirement: string }[];
}

beforeAll(async () => {
  app = createApp();
  const entrada = await request(app)
    .post("/api/auth")
    .send({ login: "teste.sst", password: SENHA });
  expect(entrada.status).toBe(200);
  sst = entrada.body.token;
});

describe("as citações da NR-1 batem com a norma [B3-4-I]", () => {
  it("a ordem de serviço cita a alínea que fala de ordem de serviço", async () => {
    const c = (await cartoes()).find((x) => x.id === "ordens_servico");
    expect(c, "o cartão existe").toBeTruthy();
    expect(c!.requirement).toContain('1.4.1 "c"');
    expect(c!.requirement, "a alínea b é informar riscos").not.toContain('1.4.1 "b"');
  });

  it("a participação cita consultar e comunicar, não o rol do GRO", async () => {
    const c = (await cartoes()).find((x) => x.id === "participacao");
    expect(c, "o cartão existe").toBeTruthy();
    expect(c!.requirement).toContain("1.5.3.3");
    expect(c!.requirement).not.toContain("1.5.3.2");
  });

  it("o treinamento cita capacitação e certificado, não análise de acidentes", async () => {
    const c = (await cartoes()).find((x) => x.id === "treinamentos");
    expect(c, "o cartão existe").toBeTruthy();
    expect(c!.requirement).toContain("1.7.1");
    expect(c!.requirement, "1.5.5.5 é análise de acidentes").not.toContain("1.5.5.5");
  });

  it("a análise da ocorrência continua citando 1.5.5.5, que é dela", async () => {
    /*
      Trava do outro lado: 1.5.5.5 está certo para a análise de acidentes e
      doenças, e corrigir o cartão de treinamento não pode levá-lo junto. A
      recusa da análise incompleta é onde o portal diz isso a quem usa.
    */
    const ocorrencia = await request(app)
      .post("/api/occurrences")
      .set(as(sst))
      .send({
        type: "DANGEROUS_EVENT",
        description: `Citação da norma ${Date.now().toString(36)}`,
        occurred_at: new Date().toISOString(),
      });
    expect(ocorrencia.status, JSON.stringify(ocorrencia.body)).toBe(201);

    const incompleta = await request(app)
      .post(`/api/occurrences/${ocorrencia.body.occurrence.id}/analyze`)
      .set(as(sst))
      .send({ generating_situation: "só um campo" });
    expect(incompleta.status).toBe(400);
    expect(incompleta.body.message).toContain("1.5.5.5");

    await request(app)
      .delete(`/api/occurrences/${ocorrencia.body.occurrence.id}`)
      .set(as(sst));
  });
});
