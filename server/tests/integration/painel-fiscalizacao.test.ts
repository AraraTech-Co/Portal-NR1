import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";

/**
 * O painel da fiscalização mostra o PGR INTEIRO, com as lacunas à mostra, e
 * cada item com autor, data e para onde ir ver a prova. [S7-B] [S7-D]
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

type Item = {
  ok: boolean;
  label: string;
  detail: string | null;
  who: string | null;
  when: string | null;
  link: string | null;
};
type Check = {
  id: string;
  title: string;
  requirement: string;
  status: "ok" | "pending" | "empty";
  items: Item[];
};

let app: Express;
let sst: { token: string; user: { id: string } };
let fiscal: { token: string; user: { id: string } };
let colaborador: { token: string; user: { id: string } };

beforeAll(async () => {
  app = createApp();
  sst = await entrar(app, "teste.sst");
  fiscal = await entrar(app, "teste.fiscal");
  colaborador = await entrar(app, "teste.colaborador");
});

const painel = (token: string, establishmentId?: string) =>
  request(app)
    .get(`/api/fiscalizacao${establishmentId ? `?establishment_id=${establishmentId}` : ""}`)
    .set(as(token));

const acha = (checks: Check[], id: string) => {
  const c = checks.find((x) => x.id === id);
  expect(c, `check ${id}`).toBeTruthy();
  return c!;
};

describe("o painel não esconde lacuna [S7-B]", () => {
  it("atividade sem perigo e função sem ordem aparecem como pendência, com onde ir", async () => {
    // Unidade nova, de propósito incompleta: sem perigo, sem AEP, sem
    // emergência, sem ordem de serviço.
    const est = (
      await request(app)
        .post("/api/establishments")
        .set(as(sst.token))
        .send({ name: `Filial crua ${SUFIXO}` })
    ).body.establishment;
    const sector = (
      await request(app)
        .post("/api/sectors")
        .set(as(sst.token))
        .send({ establishment_id: est.id, name: "Pátio" })
    ).body.sector;
    const role = (
      await request(app)
        .post("/api/job-roles")
        .set(as(sst.token))
        .send({ sector_id: sector.id, name: `Manobrista ${SUFIXO}` })
    ).body.job_role;
    const activity = (
      await request(app).post("/api/activities").set(as(sst.token)).send({
        establishment_id: est.id,
        sector_id: sector.id,
        name: `Manobrar veículos ${SUFIXO}`,
        description: "Estaciona veículos de clientes",
        job_role_ids: [role.id],
      })
    ).body.activity;

    const res = await painel(sst.token, est.id);
    expect(res.status).toBe(200);
    const checks = res.body.checks as Check[];

    const inventario = acha(checks, "inventario");
    expect(inventario.status).toBe("pending");
    const semPerigo = inventario.items.find((i) => i.label.includes(activity.name));
    expect(semPerigo?.ok).toBe(false);
    expect(semPerigo?.link, "o item diz para onde ir").toBeTruthy();

    // Função recém-criada não tem ninguém: a regra mudou na bateria 2 — só
    // é pendência a função em que há gente trabalhando sem ordem. [B2-4-B]
    const ordens = acha(checks, "ordens_servico");
    const funcao = ordens.items.find((i) => i.label === role.name);
    expect(funcao?.ok).toBe(true);
    expect(funcao?.detail).toMatch(/ninguém nesta função/i);

    const aep = acha(checks, "aep");
    expect(aep.items.find((i) => i.label === est.name)?.ok).toBe(false);

    const emergencia = acha(checks, "emergencia");
    expect(emergencia.items.find((i) => i.label === est.name)?.ok).toBe(false);

    // A exigência citada é o que o auditor cobra, não jargão do sistema.
    expect(inventario.requirement).toMatch(/NR-1/);
    expect(res.body.totals.items_pending).toBeGreaterThan(0);
  });

  it("documento nunca emitido aparece como pendente, e o emitido traz quem assinou", async () => {
    const antes = await painel(sst.token);
    const docsAntes = acha(antes.body.checks as Check[], "documentos");
    expect(docsAntes.items.length).toBe(3);

    await request(app)
      .post("/api/pgr-documents")
      .set(as(sst.token))
      .send({
        type: "CRITERIA",
        responsible_name: `Responsável ${SUFIXO}`,
        responsible_role: "Técnico de SST",
      });

    const depois = await painel(sst.token);
    const docs = acha(depois.body.checks as Check[], "documentos");
    const critérios = docs.items.find((i) => i.label.includes("Critérios"));
    expect(critérios?.ok).toBe(true);
    // Autor e data: é o que faltava no que o fiscal abria. [S7-D]
    expect(critérios?.who).toBeTruthy();
    expect(critérios?.when).toBeTruthy();
    expect(critérios?.link).toMatch(/^\/documentos\//);
  });

  it("o risco em ordem mostra quem avaliou e quem validou", async () => {
    const est = (
      await request(app)
        .post("/api/establishments")
        .set(as(sst.token))
        .send({ name: `Filial avaliada ${SUFIXO}` })
    ).body.establishment;
    const sector = (
      await request(app)
        .post("/api/sectors")
        .set(as(sst.token))
        .send({ establishment_id: est.id, name: "Produção" })
    ).body.sector;
    const activity = (
      await request(app).post("/api/activities").set(as(sst.token)).send({
        establishment_id: est.id,
        sector_id: sector.id,
        name: `Operar prensa ${SUFIXO}`,
        description: "Conforma chapas em prensa hidráulica",
      })
    ).body.activity;
    const hazard = (
      await request(app).post("/api/hazards").set(as(sst.token)).send({
        activity_id: activity.id,
        description: `Prensagem de membros ${SUFIXO}`,
        category: "ACCIDENT",
      })
    ).body.hazard;
    const risk = (
      await request(app)
        .post("/api/risks")
        .set(as(sst.token))
        .send({ hazard_id: hazard.id, description: `Amputação ${SUFIXO}` })
    ).body.risk;

    const semAvaliacao = await painel(sst.token, est.id);
    const antes = acha(semAvaliacao.body.checks as Check[], "inventario").items.find((i) =>
      i.label.includes(risk.description),
    );
    expect(antes?.ok).toBe(false);
    expect(antes?.label).toMatch(/sem avaliação validada/i);

    const metodologias = (await request(app).get("/api/methodologies").set(as(sst.token)))
      .body.methodologies as { isDefault: boolean; versions: { id: string }[] }[];
    const versao = (metodologias.find((m) => m.isDefault) ?? metodologias[0]!).versions[0]!.id;
    const avaliacao = (
      await request(app).post("/api/assessments").set(as(sst.token)).send({
        risk_id: risk.id,
        methodology_version_id: versao,
        severity: 5,
        probability: 2,
      })
    ).body.assessment;
    const owner = await entrar(app, "teste.owner");
    await request(app)
      .post(`/api/assessments/${avaliacao.id}/validate`)
      .set(as(owner.token));

    const depois = await painel(sst.token, est.id);
    const item = acha(depois.body.checks as Check[], "inventario").items.find((i) =>
      i.label === risk.description,
    );
    expect(item?.ok).toBe(true);
    expect(item?.who).toMatch(/avaliado por .+, validado por .+/);
    expect(item?.when).toBeTruthy();
  });
});

describe("quem vê o painel [S7-B]", () => {
  it("o fiscal abre o painel e o histórico", async () => {
    const res = await painel(fiscal.token);
    expect(res.status).toBe(200);
    expect(res.body.people_detail).toBe(true);
    expect((res.body.checks as Check[]).length).toBeGreaterThanOrEqual(8);

    const hist = await request(app)
      .get("/api/fiscalizacao/historico")
      .set(as(fiscal.token));
    expect(hist.status).toBe(200);
    const eventos = hist.body.events as { action: string; who: string; at: string }[];
    expect(eventos.length).toBeGreaterThan(0);
    expect(eventos[0]!.who).toBeTruthy();
    expect(eventos[0]!.at).toBeTruthy();
  });

  it("o histórico do fiscal não é a porta dos fundos de holerite, atestado nem denúncia", async () => {
    const hist = await request(app)
      .get("/api/fiscalizacao/historico?limit=200")
      .set(as(fiscal.token));
    expect(hist.status).toBe(200);
    const acoes = (hist.body.events as { action: string }[]).map((e) => e.action);
    expect(acoes.length).toBeGreaterThan(0);
    for (const proibido of [
      "payslip.",
      "medical_certificate.",
      "ethics_report.",
      "leave.",
      "announcement.",
      "membership.",
      "user.",
      "idea.",
      "climate_survey.",
    ]) {
      expect(
        acoes.some((a) => a.startsWith(proibido)),
        `o fiscal não vê ${proibido}*`,
      ).toBe(false);
    }

    // Quem responde pelo PGR vê a trilha inteira.
    const owner = await entrar(app, "teste.owner");
    const completo = await request(app)
      .get("/api/fiscalizacao/historico?limit=200")
      .set(as(owner.token));
    expect(completo.status).toBe(200);
    expect((completo.body.events as unknown[]).length).toBeGreaterThan(0);
  });

  it("o colaborador vê a lacuna em número, nunca o nome do colega, e não vê o histórico", async () => {
    const res = await painel(colaborador.token);
    expect(res.status).toBe(200);
    expect(res.body.people_detail).toBe(false);

    const treinamentos = acha(res.body.checks as Check[], "treinamentos");
    for (const item of treinamentos.items) {
      expect(item.detail ?? "").toMatch(/de \d+ com certificado|nenhum trabalhador/);
    }

    const hist = await request(app)
      .get("/api/fiscalizacao/historico")
      .set(as(colaborador.token));
    expect(hist.status).toBe(403);
  });

  it("sem login, nada", async () => {
    expect((await request(app).get("/api/fiscalizacao")).status).toBe(401);
    expect((await request(app).get("/api/fiscalizacao/historico")).status).toBe(401);
  });
});
