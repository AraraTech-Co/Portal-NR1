import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";

/**
 * Avaliar o risco: o nível sai da matriz da metodologia, e quem avaliou não
 * valida. A nova avaliação substitui a anterior. [S2-A]
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
let owner: { token: string; user: { id: string } };
let colaborador: string;
/** A 5x5 completa (global) e a reduzida da org de teste, que só define 1-1 e 5-5. */
let versionId: string;
let versionReduzidaId: string;

async function novoRisco(nome: string) {
  const est = (
    await request(app).post("/api/establishments").set(as(sst.token)).send({ name: `${nome} ${SUFIXO}` })
  ).body.establishment;
  const sector = (
    await request(app).post("/api/sectors").set(as(sst.token)).send({ establishment_id: est.id, name: "Oficina" })
  ).body.sector;
  const activity = (
    await request(app).post("/api/activities").set(as(sst.token)).send({
      establishment_id: est.id,
      sector_id: sector.id,
      name: `Soldar ${nome}`,
      description: "Solda peças de aço com eletrodo revestido",
    })
  ).body.activity;
  const hazard = (
    await request(app)
      .post("/api/hazards")
      .set(as(sst.token))
      .send({ activity_id: activity.id, description: `Fumos metálicos ${nome}`, category: "CHEMICAL" })
  ).body.hazard;
  return (
    await request(app)
      .post("/api/risks")
      .set(as(sst.token))
      .send({ hazard_id: hazard.id, description: `Intoxicação ${nome}` })
  ).body.risk.id as string;
}

const avaliar = (token: string, riskId: string, severity: number, probability: number, extra = {}) =>
  request(app)
    .post("/api/assessments")
    .set(as(token))
    .send({ risk_id: riskId, methodology_version_id: versionId, severity, probability, ...extra });

beforeAll(async () => {
  app = createApp();
  sst = await entrar(app, "teste.sst");
  owner = await entrar(app, "teste.owner");
  colaborador = (await entrar(app, "teste.colaborador")).token;
  const ms = (await request(app).get("/api/methodologies").set(as(sst.token))).body
    .methodologies as { name: string; isDefault: boolean; versions: { id: string }[] }[];
  const completa = ms.find((m) => m.isDefault) ?? ms[0]!;
  versionId = completa.versions[0]!.id;
  versionReduzidaId = (ms.find((m) => m !== completa) ?? completa).versions[0]!.id;
});

describe("o nível sai da matriz, não do dedo [S2-A]", () => {
  it("a matriz decide o nível, e combinação fora dela é recusada", async () => {
    const riskId = await novoRisco("Alfa");

    const alta = await avaliar(sst.token, riskId, 5, 5, {
      severity_reason: "Pode causar doença grave",
      probability_reason: "Exposição diária sem exaustão",
    });
    expect(alta.status).toBe(201);
    expect(alta.body.assessment.resultingLevel).toBe("INTOLERABLE");
    expect(alta.body.assessment.status).toBe("DRAFT");

    // na 5x5 completa, 3x2 é moderado
    const media = await avaliar(sst.token, riskId, 3, 2);
    expect(media.status).toBe(201);
    expect(media.body.assessment.resultingLevel).toBe("MODERATE");

    // fora da escala não passa
    const foraDaEscala = await avaliar(sst.token, riskId, 9, 1);
    expect(foraDaEscala.status).toBe(400);
    expect(foraDaEscala.body.message).toMatch(/escala/);

    // numa metodologia reduzida, combinação que a matriz não define é recusada
    const semCombinacao = await request(app)
      .post("/api/assessments")
      .set(as(sst.token))
      .send({ risk_id: riskId, methodology_version_id: versionReduzidaId, severity: 1, probability: 5 });
    expect(semCombinacao.status).toBe(400);
    expect(semCombinacao.body.message).toMatch(/[Mm]atriz/);
  });

  it("quem avaliou não valida; outra pessoa valida e o risco fica com o nível", async () => {
    const riskId = await novoRisco("Beta");
    const a = await avaliar(sst.token, riskId, 1, 1);
    const id = a.body.assessment.id as string;

    const proprio = await request(app).post(`/api/assessments/${id}/validate`).set(as(sst.token));
    expect(proprio.status).toBe(403);
    expect(proprio.body.message).toMatch(/separação de funções/);

    const ok = await request(app).post(`/api/assessments/${id}/validate`).set(as(owner.token));
    expect(ok.status).toBe(200);
    expect(ok.body.assessment.status).toBe("VALIDATED");
    expect(ok.body.assessment.expiresAt).toBeTruthy();

    // validada é imutável
    expect((await request(app).post(`/api/assessments/${id}/validate`).set(as(owner.token))).status).toBe(409);
  });

  it("a reavaliação substitui a anterior e aparece no histórico", async () => {
    const riskId = await novoRisco("Gama");
    const primeira = await avaliar(sst.token, riskId, 5, 5);
    await request(app).post(`/api/assessments/${primeira.body.assessment.id}/validate`).set(as(owner.token));

    const segunda = await avaliar(sst.token, riskId, 1, 1, { controls_considered: "Exaustor instalado" });
    await request(app).post(`/api/assessments/${segunda.body.assessment.id}/validate`).set(as(owner.token));

    const hist = await request(app).get(`/api/risks/${riskId}/historico`).set(as(sst.token));
    const avaliacoes = hist.body.assessments as { id: string; level: string; supersededAt: string | null }[];
    expect(avaliacoes).toHaveLength(2);
    expect(avaliacoes.find((x) => x.id === primeira.body.assessment.id)?.supersededAt).toBeTruthy();
    expect(avaliacoes.find((x) => x.id === segunda.body.assessment.id)?.supersededAt).toBeNull();

    const acoes = (hist.body.changes as { action: string }[]).map((c) => c.action);
    expect(acoes).toContain("assessment.create");
    expect(acoes).toContain("assessment.validate");
  });

  it("quem só lê não avalia nem valida", async () => {
    const riskId = await novoRisco("Delta");
    expect((await avaliar(colaborador, riskId, 1, 1)).status).toBe(403);
    const a = await avaliar(sst.token, riskId, 1, 1);
    expect(
      (await request(app).post(`/api/assessments/${a.body.assessment.id}/validate`).set(as(colaborador))).status,
    ).toBe(403);
  });
});
