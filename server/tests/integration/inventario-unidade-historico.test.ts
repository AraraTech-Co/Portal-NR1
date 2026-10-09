import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";

/**
 * Inventário por unidade [S6-D] e histórico de cada risco [S2-N].
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
let outraOrg: string;

/** Uma unidade inteira: estabelecimento → setor → atividade → perigo → risco. */
async function montarUnidade(nome: string) {
  const est = (
    await request(app).post("/api/establishments").set(as(sst.token)).send({ name: `${nome} ${SUFIXO}` })
  ).body.establishment;
  const sector = (
    await request(app).post("/api/sectors").set(as(sst.token)).send({ establishment_id: est.id, name: "Produção" })
  ).body.sector;
  const activity = (
    await request(app)
      .post("/api/activities")
      .set(as(sst.token))
      .send({
        establishment_id: est.id,
        sector_id: sector.id,
        name: `Operar prensa ${nome}`,
        description: "Opera a prensa hidráulica com peças de até 8 kg",
      })
  ).body.activity;
  const hazard = (
    await request(app)
      .post("/api/hazards")
      .set(as(sst.token))
      .send({ activity_id: activity.id, description: `Prensagem ${nome}`, category: "ACCIDENT" })
  ).body.hazard;
  const risk = (
    await request(app)
      .post("/api/risks")
      .set(as(sst.token))
      .send({ hazard_id: hazard.id, description: `Esmagamento de mão ${nome}` })
  ).body.risk;
  return { est, sector, activity, hazard, risk };
}

beforeAll(async () => {
  app = createApp();
  sst = await entrar(app, "teste.sst");
  owner = await entrar(app, "teste.owner");
  outraOrg = (await request(app).post("/api/auth").send({ login: "admin", password: "admin123" })).body.token;
});

describe("inventário por unidade [S6-D]", () => {
  it("o filtro traz só os perigos daquele estabelecimento", async () => {
    const a = await montarUnidade("Alfa");
    const b = await montarUnidade("Beta");

    const soA = await request(app).get(`/api/inventory?establishment_id=${a.est.id}`).set(as(sst.token));
    expect(soA.status).toBe(200);
    const locaisA = new Set((soA.body.inventory.items as { establishment: string }[]).map((i) => i.establishment));
    expect([...locaisA]).toEqual([a.est.name]);

    const soB = await request(app).get(`/api/inventory?establishment_id=${b.est.id}`).set(as(sst.token));
    const locaisB = new Set((soB.body.inventory.items as { establishment: string }[]).map((i) => i.establishment));
    expect([...locaisB]).toEqual([b.est.name]);

    const tudo = await request(app).get("/api/inventory").set(as(sst.token));
    const locais = new Set((tudo.body.inventory.items as { establishment: string }[]).map((i) => i.establishment));
    expect(locais.has(a.est.name)).toBe(true);
    expect(locais.has(b.est.name)).toBe(true);
  });
});

describe("histórico do risco [S2-N]", () => {
  it("mostra de onde vem, as avaliações (inclusive a substituída) e quem mudou o quê", async () => {
    const u = await montarUnidade("Gama");

    // a atividade muda: a trilha tem de registrar
    await request(app)
      .patch(`/api/activities/${u.activity.id}`)
      .set(as(sst.token))
      .send({ description: "Opera a prensa hidráulica com peças de até 20 kg" });

    const metodologia = (await request(app).get("/api/methodologies").set(as(sst.token))).body.methodologies[0];
    const versao = metodologia.versions[0].id;

    const primeira = await request(app)
      .post("/api/assessments")
      .set(as(sst.token))
      .send({ risk_id: u.risk.id, methodology_version_id: versao, severity: 5, probability: 5 });
    expect(primeira.status).toBe(201);
    // quem avaliou não valida
    expect(
      (await request(app).post(`/api/assessments/${primeira.body.assessment.id}/validate`).set(as(sst.token))).status,
    ).toBe(403);
    expect(
      (await request(app).post(`/api/assessments/${primeira.body.assessment.id}/validate`).set(as(owner.token))).status,
    ).toBe(200);

    // uma segunda avaliação substitui a primeira
    const segunda = await request(app)
      .post("/api/assessments")
      .set(as(sst.token))
      .send({ risk_id: u.risk.id, methodology_version_id: versao, severity: 1, probability: 1 });
    await request(app).post(`/api/assessments/${segunda.body.assessment.id}/validate`).set(as(owner.token));

    const hist = await request(app).get(`/api/risks/${u.risk.id}/historico`).set(as(sst.token));
    expect(hist.status).toBe(200);
    expect(hist.body.risk.hazard.establishment).toBe(u.est.name);
    expect(hist.body.risk.hazard.activity).toMatch(/Operar prensa/);

    const avaliacoes = hist.body.assessments as {
      id: string;
      level: string;
      supersededAt: string | null;
      assessor: { name: string };
      validatedBy: { name: string } | null;
      methodology: string;
    }[];
    expect(avaliacoes).toHaveLength(2);
    const antiga = avaliacoes.find((a) => a.id === primeira.body.assessment.id)!;
    const atual = avaliacoes.find((a) => a.id === segunda.body.assessment.id)!;
    expect(antiga.supersededAt).toBeTruthy();
    expect(atual.supersededAt).toBeNull();
    expect(atual.assessor.name).toBe("Técnico SST Teste");
    expect(atual.validatedBy?.name).toBe("Owner Conta Teste");
    expect(atual.methodology).toContain("v");

    const mudancas = hist.body.changes as { action: string; before: unknown; after: unknown }[];
    const daAtividade = mudancas.find((c) => c.action === "activity.update");
    expect(daAtividade).toBeTruthy();
    expect(JSON.stringify(daAtividade?.before)).toContain("8 kg");
    expect(JSON.stringify(daAtividade?.after)).toContain("20 kg");
  });

  it("risco de outra organização não é encontrado; sem login, nada", async () => {
    const u = await montarUnidade("Delta");
    expect((await request(app).get(`/api/risks/${u.risk.id}/historico`).set(as(outraOrg))).status).toBe(404);
    expect((await request(app).get(`/api/risks/${u.risk.id}/historico`)).status).toBe(401);
  });
});
