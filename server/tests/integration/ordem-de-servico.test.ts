import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";

/**
 * Ordem de serviço de SST (NR-1 1.4.1 "b"): o documento por função e a
 * CIÊNCIA de quem trabalha nela. Sem a ciência registrada, a obrigação não
 * está cumprida — é isso que a fiscalização pede. [S7-F]
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
let colaborador: { token: string; user: { id: string } };
let supervisor: { token: string; user: { id: string } };
let fiscal: { token: string; user: { id: string } };
/** A função do seed: o colaborador, o supervisor e o RH estão nela. */
let funcaoDoSeed: string;

beforeAll(async () => {
  app = createApp();
  sst = await entrar(app, "teste.sst");
  owner = await entrar(app, "teste.owner");
  colaborador = await entrar(app, "teste.colaborador");
  supervisor = await entrar(app, "teste.supervisor");
  fiscal = await entrar(app, "teste.fiscal");

  const minha = await request(app).get("/api/service-orders").set(as(colaborador.token));
  expect(minha.status).toBe(200);
  expect(minha.body.my_job_role_id, "o colaborador do seed tem função").toBeTruthy();
  funcaoDoSeed = minha.body.my_job_role_id as string;
});

/** Uma função nova, com atividade, perigo, risco avaliado e medida. */
async function funcaoComRisco(nome: string) {
  const est = (
    await request(app)
      .post("/api/establishments")
      .set(as(sst.token))
      .send({ name: `${nome} ${SUFIXO}` })
  ).body.establishment;
  const sector = (
    await request(app)
      .post("/api/sectors")
      .set(as(sst.token))
      .send({ establishment_id: est.id, name: "Expedição" })
  ).body.sector;
  const role = (
    await request(app)
      .post("/api/job-roles")
      .set(as(sst.token))
      .send({ sector_id: sector.id, name: `Conferente ${nome}`, description: "Confere carga" })
  ).body.job_role;
  const activity = (
    await request(app).post("/api/activities").set(as(sst.token)).send({
      establishment_id: est.id,
      sector_id: sector.id,
      name: `Carregar caminhão ${nome}`,
      description: "Movimenta caixas até o veículo",
      job_role_ids: [role.id],
    })
  ).body.activity;
  const hazard = (
    await request(app).post("/api/hazards").set(as(sst.token)).send({
      activity_id: activity.id,
      description: `Carga manual acima do recomendado ${nome}`,
      category: "ERGONOMIC",
      source: "Caixas de 25 kg sem auxílio mecânico",
      consequences: "Lombalgia",
    })
  ).body.hazard;
  const risk = (
    await request(app)
      .post("/api/risks")
      .set(as(sst.token))
      .send({ hazard_id: hazard.id, description: `Lesão na coluna ${nome}` })
  ).body.risk;

  const metodologias = (await request(app).get("/api/methodologies").set(as(sst.token)))
    .body.methodologies as { isDefault: boolean; versions: { id: string }[] }[];
  const versao = (metodologias.find((m) => m.isDefault) ?? metodologias[0]!).versions[0]!.id;
  const avaliacao = (
    await request(app).post("/api/assessments").set(as(sst.token)).send({
      risk_id: risk.id,
      methodology_version_id: versao,
      severity: 3,
      probability: 3,
    })
  ).body.assessment;
  await request(app).post(`/api/assessments/${avaliacao.id}/validate`).set(as(owner.token));

  await request(app).post("/api/controls").set(as(sst.token)).send({
    risk_id: risk.id,
    type: "ENGINEERING",
    description: "Paleteira elétrica na expedição",
  });

  return {
    establishmentId: est.id as string,
    roleId: role.id as string,
    activityId: activity.id as string,
  };
}

const emitir = (roleId: string, extra: Record<string, unknown> = {}) =>
  request(app)
    .post("/api/service-orders")
    .set(as(sst.token))
    .send({
      job_role_id: roleId,
      duties: "Usar a paleteira. Avisar o supervisor de qualquer dor ou risco.",
      emergency_instructions: "Parar a tarefa e acionar o supervisor.",
      ...extra,
    });

describe("ordem de serviço por função [S7-F]", () => {
  it("a ordem emitida leva o que a função faz, a que expõe e como se protege", async () => {
    const { roleId } = await funcaoComRisco("Alfa");

    const res = await emitir(roleId);
    expect(res.status).toBe(201);
    expect(res.body.service_order.version).toBe(1);

    const aberta = await request(app)
      .get(`/api/service-orders/${res.body.service_order.id}`)
      .set(as(sst.token));
    expect(aberta.status).toBe(200);
    const ordem = aberta.body.service_order;
    expect(ordem.duties).toMatch(/paleteira/i);
    expect(ordem.emergencyInstructions).toBeTruthy();
    expect(ordem.responsibleName).toBeTruthy();
    expect(ordem.issuedBy.name).toBeTruthy();
    expect(ordem.organization.name).toBeTruthy();
    expect(ordem.is_current).toBe(true);

    const atividade = ordem.content.activities[0];
    expect(atividade.name).toMatch(/Carregar caminhão/);
    const perigo = atividade.hazards[0];
    expect(perigo.description).toMatch(/Carga manual/);
    expect(perigo.consequences).toBe("Lombalgia");
    const risco = perigo.risks[0];
    // O nível vem da avaliação validada — a ordem não estima nada.
    expect(risco.level).toBe("MODERATE");
    expect(risco.controls[0].description).toMatch(/Paleteira/);
  });

  it("sem escrever as obrigações, não emite", async () => {
    const { roleId } = await funcaoComRisco("Beta");
    const res = await request(app)
      .post("/api/service-orders")
      .set(as(sst.token))
      .send({ job_role_id: roleId });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/obriga/i);
  });

  it("o retrato é do instante da emissão: perigo novo não entra na ordem antiga", async () => {
    const { roleId, activityId } = await funcaoComRisco("Gama");
    const v1 = (await emitir(roleId)).body.service_order;

    const antes = (
      await request(app).get(`/api/service-orders/${v1.id}`).set(as(sst.token))
    ).body.service_order.content.activities[0].hazards.length;

    // Perigo descoberto DEPOIS da emissão.
    await request(app).post("/api/hazards").set(as(sst.token)).send({
      activity_id: activityId,
      description: `Piso molhado na expedição ${SUFIXO}`,
      category: "ACCIDENT",
    });

    const v2 = (await emitir(roleId)).body.service_order;
    expect(v2.version).toBe(2);

    const antiga = (
      await request(app).get(`/api/service-orders/${v1.id}`).set(as(sst.token))
    ).body.service_order;
    expect(antiga.content.activities[0].hazards.length, "a v1 não muda").toBe(antes);
    expect(antiga.is_current).toBe(false);
    expect(antiga.current_version).toBe(2);

    const nova = (
      await request(app).get(`/api/service-orders/${v2.id}`).set(as(sst.token))
    ).body.service_order;
    expect(nova.content.activities[0].hazards.length).toBe(antes + 1);
  });
});

describe("a ciência é do trabalhador [S7-F]", () => {
  it("quem está na função dá ciência uma vez; quem não está, não dá", async () => {
    const emitida = (await emitir(funcaoDoSeed)).body.service_order;

    const foraDaFuncao = await request(app)
      .post(`/api/service-orders/${emitida.id}/ciencia`)
      .set(as(sst.token));
    expect(foraDaFuncao.status).toBe(403);
    expect(foraDaFuncao.body.message).toMatch(/função/i);

    const primeira = await request(app)
      .post(`/api/service-orders/${emitida.id}/ciencia`)
      .set(as(colaborador.token));
    expect(primeira.status).toBe(201);

    const repetida = await request(app)
      .post(`/api/service-orders/${emitida.id}/ciencia`)
      .set(as(colaborador.token));
    expect(repetida.status).toBe(409);

    const aberta = await request(app)
      .get(`/api/service-orders/${emitida.id}`)
      .set(as(colaborador.token));
    expect(aberta.body.service_order.my_ack_at).toBeTruthy();
    expect(aberta.body.service_order.can_acknowledge).toBe(false);
  });

  it("versão nova pede ciência nova, e a antiga não serve mais", async () => {
    const antiga = (await emitir(funcaoDoSeed)).body.service_order;
    await request(app)
      .post(`/api/service-orders/${antiga.id}/ciencia`)
      .set(as(supervisor.token));

    const nova = (await emitir(funcaoDoSeed)).body.service_order;
    expect(nova.version).toBeGreaterThan(antiga.version);

    const naAntiga = await request(app)
      .post(`/api/service-orders/${antiga.id}/ciencia`)
      .set(as(colaborador.token));
    expect(naAntiga.status).toBe(409);
    expect(naAntiga.body.message).toMatch(new RegExp(`v${nova.version}`));

    const naNova = await request(app)
      .get(`/api/service-orders/${nova.id}`)
      .set(as(supervisor.token));
    expect(naNova.body.service_order.my_ack_at).toBeNull();
    expect(naNova.body.service_order.can_acknowledge).toBe(true);
  });

  it("a lista por função mostra a lacuna: sem ordem e sem ciência", async () => {
    const { establishmentId, roleId } = await funcaoComRisco("Delta");

    const semOrdem = await request(app)
      .get(`/api/service-orders?establishment_id=${establishmentId}`)
      .set(as(sst.token));
    expect(semOrdem.status).toBe(200);
    const linha = (semOrdem.body.job_roles as { id: string; current: unknown }[]).find(
      (r) => r.id === roleId,
    );
    expect(linha?.current, "função sem ordem aparece como pendente").toBeNull();

    await emitir(roleId);
    const comOrdem = await request(app)
      .get(`/api/service-orders?establishment_id=${establishmentId}`)
      .set(as(sst.token));
    const depois = (
      comOrdem.body.job_roles as {
        id: string;
        current: { version: number; acknowledged: number } | null;
      }[]
    ).find((r) => r.id === roleId);
    expect(depois?.current?.version).toBe(1);
    expect(depois?.current?.acknowledged).toBe(0);
  });
});

describe("a prova para a fiscalização [S7-F] [S7-D]", () => {
  it("quem emite e o fiscal veem quem deu ciência e quem falta; o colaborador não", async () => {
    const emitida = (await emitir(funcaoDoSeed)).body.service_order;
    await request(app)
      .post(`/api/service-orders/${emitida.id}/ciencia`)
      .set(as(colaborador.token));

    const paraOSst = await request(app)
      .get(`/api/service-orders/${emitida.id}/ciencias`)
      .set(as(sst.token));
    expect(paraOSst.status).toBe(200);
    const pessoas = paraOSst.body.people as { id: string; acknowledged_at: string | null }[];
    expect(pessoas.find((p) => p.id === colaborador.user.id)?.acknowledged_at).toBeTruthy();
    expect(paraOSst.body.acknowledged).toBeGreaterThanOrEqual(1);
    expect(paraOSst.body.pending).toBeGreaterThanOrEqual(1);

    const paraOFiscal = await request(app)
      .get(`/api/service-orders/${emitida.id}/ciencias`)
      .set(as(fiscal.token));
    expect(paraOFiscal.status).toBe(200);
    expect(paraOFiscal.body.people.length).toBe(pessoas.length);

    const paraOColaborador = await request(app)
      .get(`/api/service-orders/${emitida.id}/ciencias`)
      .set(as(colaborador.token));
    expect(paraOColaborador.status).toBe(403);
  });

  it("o fiscal lê a ordem, mas não emite nem dá ciência", async () => {
    const { roleId } = await funcaoComRisco("Epsilon");
    const emitida = (await emitir(roleId)).body.service_order;

    const leitura = await request(app)
      .get(`/api/service-orders/${emitida.id}`)
      .set(as(fiscal.token));
    expect(leitura.status).toBe(200);
    expect(leitura.body.service_order.can_acknowledge).toBe(false);

    const tentaEmitir = await request(app)
      .post("/api/service-orders")
      .set(as(fiscal.token))
      .send({ job_role_id: roleId, duties: "qualquer coisa" });
    expect(tentaEmitir.status).toBe(403);

    const tentaCiencia = await request(app)
      .post(`/api/service-orders/${emitida.id}/ciencia`)
      .set(as(fiscal.token));
    expect(tentaCiencia.status).toBe(403);
  });

  it("outra organização não acha a ordem; sem login, nada", async () => {
    const { roleId } = await funcaoComRisco("Zeta");
    const emitida = (await emitir(roleId)).body.service_order;

    const outra = await request(app).post("/api/auth").send({ login: "admin", password: "admin123" });
    expect(outra.status).toBe(200);
    const fora = await request(app)
      .get(`/api/service-orders/${emitida.id}`)
      .set(as(outra.body.token));
    expect(fora.status).toBe(404);

    const anonimo = await request(app).get(`/api/service-orders/${emitida.id}`);
    expect(anonimo.status).toBe(401);
  });
});
