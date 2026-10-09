import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { isValidCnpj } from "../../src/helper/cnpj";

/**
 * Operação editável: o estabelecimento tem endereço [S1-H], a atividade se
 * corrige [S2-G] e precisa de descrição [S1-J]; a mudança fica na trilha
 * [S2-N]; arquivar não deixa o inventário órfão.
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
let colaborador: string;

beforeAll(async () => {
  app = createApp();
  sst = await entrar(app, "teste.sst");
  colaborador = (await entrar(app, "teste.colaborador")).token;
});

describe("CNPJ", () => {
  it("confere os dígitos", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000181")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-82")).toBe(false);
    expect(isValidCnpj("11.111.111/1111-11")).toBe(false);
    expect(isValidCnpj("123")).toBe(false);
  });
});

describe("estabelecimento com endereço [S1-H]", () => {
  let id: string;

  it("cria com CNPJ válido (guarda só os dígitos) e recusa inválido", async () => {
    const ruim = await request(app)
      .post("/api/establishments")
      .set(as(sst.token))
      .send({ name: `Loja ${SUFIXO}`, tax_id: "11.222.333/0001-82" });
    expect(ruim.status).toBe(400);

    const ok = await request(app)
      .post("/api/establishments")
      .set(as(sst.token))
      .send({ name: `Loja ${SUFIXO}`, tax_id: "11.222.333/0001-81", address: "  Rua das Flores, 10 — Americana/SP " });
    expect(ok.status).toBe(201);
    expect(ok.body.establishment.taxId).toBe("11222333000181");
    expect(ok.body.establishment.address).toBe("Rua das Flores, 10 — Americana/SP");
    id = ok.body.establishment.id;
  });

  it("edita o endereço e a mudança fica na trilha", async () => {
    const res = await request(app)
      .patch(`/api/establishments/${id}`)
      .set(as(sst.token))
      .send({ address: "Av. Brasil, 500 — Americana/SP" });
    expect(res.status).toBe(200);
    expect(res.body.establishment.address).toBe("Av. Brasil, 500 — Americana/SP");

    const trilha = await prisma.auditEvent.findFirst({
      where: { action: "establishment.update", entityId: id },
      orderBy: { createdAt: "desc" },
    });
    expect(trilha?.actorId).toBe(sst.user.id);
    expect(trilha?.before).toMatchObject({ address: "Rua das Flores, 10 — Americana/SP" });
    expect(trilha?.after).toMatchObject({ address: "Av. Brasil, 500 — Americana/SP" });
  });

  it("nome não fica vazio; quem só lê não edita", async () => {
    expect((await request(app).patch(`/api/establishments/${id}`).set(as(sst.token)).send({ name: "  " })).status).toBe(400);
    expect((await request(app).patch(`/api/establishments/${id}`).set(as(colaborador)).send({ address: "x" })).status).toBe(403);
  });
});

describe("atividade se corrige e tem descrição [S2-G] [S1-J]", () => {
  let estId: string;
  let sectorId: string;
  let activityId: string;

  beforeAll(async () => {
    estId = (
      await request(app).post("/api/establishments").set(as(sst.token)).send({ name: `Unidade ${SUFIXO}` })
    ).body.establishment.id;
    sectorId = (
      await request(app).post("/api/sectors").set(as(sst.token)).send({ establishment_id: estId, name: "Estoque" })
    ).body.sector.id;
  });

  it("sem descrição não cria", async () => {
    const res = await request(app)
      .post("/api/activities")
      .set(as(sst.token))
      .send({ establishment_id: estId, sector_id: sectorId, name: "Repor prateleira" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Descreva a atividade/);
  });

  it("cria com descrição e corrige depois", async () => {
    const criada = await request(app)
      .post("/api/activities")
      .set(as(sst.token))
      .send({ establishment_id: estId, sector_id: sectorId, name: "Repor prateleira", description: "Sobe na escada" });
    expect(criada.status).toBe(201);
    activityId = criada.body.activity.id;

    const corrigida = await request(app)
      .patch(`/api/activities/${activityId}`)
      .set(as(sst.token))
      .send({ description: "Sobe na escada de 3 degraus para repor caixas de até 15 kg" });
    expect(corrigida.status).toBe(200);
    expect(corrigida.body.activity.description).toMatch(/15 kg/);

    const apagar = await request(app)
      .patch(`/api/activities/${activityId}`)
      .set(as(sst.token))
      .send({ description: "" });
    expect(apagar.status).toBe(400);
  });

  it("arquivar não deixa o inventário órfão", async () => {
    const hazard = await request(app)
      .post("/api/hazards")
      .set(as(sst.token))
      .send({ activity_id: activityId, description: "Queda da escada", category: "ACCIDENT" });
    expect(hazard.status).toBe(201);

    // atividade com perigo, setor com atividade, estabelecimento com setor
    expect((await request(app).delete(`/api/activities/${activityId}`).set(as(sst.token))).status).toBe(409);
    expect((await request(app).delete(`/api/sectors/${sectorId}`).set(as(sst.token))).status).toBe(409);
    expect((await request(app).delete(`/api/establishments/${estId}`).set(as(sst.token))).status).toBe(409);

    // de baixo para cima, arquiva
    expect((await request(app).delete(`/api/hazards/${hazard.body.hazard.id}`).set(as(sst.token))).status).toBe(200);
    expect((await request(app).delete(`/api/activities/${activityId}`).set(as(sst.token))).status).toBe(200);
    expect((await request(app).delete(`/api/sectors/${sectorId}`).set(as(sst.token))).status).toBe(200);
    expect((await request(app).delete(`/api/establishments/${estId}`).set(as(sst.token))).status).toBe(200);
  });
});
