import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O resgate de um prêmio, do pedido à entrega.
 *
 * A tela de Gamificação mostrava saldo e prêmios e não deixava fazer nada;
 * decidir resgate existia na API, mas nada listava os pedidos — quem
 * entrega o prêmio não tinha como saber que alguém pediu. E recusar não
 * devolvia os pontos: a pessoa pagava por um resgate que ninguém entregou.
 * [OB-4] [CB-14]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: { token: string; user: { id: string } };
let colaborador: { token: string; user: { id: string } };
/** Lê o módulo e não cuida dele — pela matriz, é o caso do SST. */
let sst: { token: string; user: { id: string } };
const premios: string[] = [];
const lancamentos: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

async function saldo(token: string): Promise<number> {
  const res = await request(app).get("/api/points/balance").set(as(token));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.balance as number;
}

/** Um prêmio novo, com estoque de uma unidade. */
async function publicarPremio(nome: string, custo: number, estoque = 1) {
  const res = await request(app)
    .post("/api/rewards")
    .set(as(rh.token))
    .send({ name: nome, cost: custo, stock: estoque });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  premios.push(res.body.reward.id);
  return res.body.reward as { id: string; cost: number; stock: number | null };
}

async function darPontos(quantos: number) {
  const res = await request(app)
    .post("/api/point-entries")
    .set(as(rh.token))
    .send({
      user_id: colaborador.user.id,
      activity: `teste_${SUFIXO}`,
      points: quantos,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  lancamentos.push(res.body.entry?.id ?? "");
}

beforeAll(async () => {
  app = createApp();
  rh = await entrar("teste.rh");
  colaborador = await entrar("teste.colaborador");
  sst = await entrar("teste.sst");
});

afterAll(async () => {
  await prisma.rewardRedemption.deleteMany({ where: { rewardId: { in: premios } } });
  await prisma.pointEntry.deleteMany({
    where: { organizationId: ORG_ID, activity: { contains: SUFIXO } },
  });
  await prisma.pointEntry.deleteMany({
    where: {
      organizationId: ORG_ID,
      OR: premios.map((id) => ({ activity: { contains: id } })),
    },
  });
  await prisma.notification.deleteMany({ where: { entityType: "RewardRedemption" } });
  await prisma.reward.deleteMany({ where: { id: { in: premios } } });
});

describe("quem entrega o prêmio vê o pedido [OB-4]", () => {
  it("o resgate aparece na lista de quem cuida do módulo", async () => {
    const premio = await publicarPremio(`Camiseta ${SUFIXO}`, 10);
    await darPontos(10);

    const resgate = await request(app)
      .post(`/api/rewards/${premio.id}/redeem`)
      .set(as(colaborador.token));
    expect(resgate.status, JSON.stringify(resgate.body)).toBe(201);

    const doRh = await request(app).get("/api/reward-redemptions").set(as(rh.token));
    expect(doRh.status, JSON.stringify(doRh.body)).toBe(200);
    expect(doRh.body.manages).toBe(true);
    const meu = doRh.body.redemptions.find(
      (r: { id: string }) => r.id === resgate.body.redemption.id,
    );
    expect(meu, "o resgate na lista de quem entrega").toBeTruthy();
    expect(meu.status).toBe("REQUESTED");
    expect(meu.user.id).toBe(colaborador.user.id);
    expect(meu.reward.name).toBe(`Camiseta ${SUFIXO}`);
  });

  it("quem pediu vê o seu, e só o seu", async () => {
    const premio = await publicarPremio(`Caneca ${SUFIXO}`, 5);
    await darPontos(5);
    const meu = await request(app)
      .post(`/api/rewards/${premio.id}/redeem`)
      .set(as(colaborador.token));
    expect(meu.status).toBe(201);

    const dele = await request(app)
      .get("/api/reward-redemptions")
      .set(as(colaborador.token));
    expect(dele.status, JSON.stringify(dele.body)).toBe(200);
    expect(dele.body.manages).toBe(false);
    for (const r of dele.body.redemptions) {
      expect(r.user.id).toBe(colaborador.user.id);
    }
    expect(
      dele.body.redemptions.map((r: { id: string }) => r.id),
    ).toContain(meu.body.redemption.id);

    /*
      Quem só lê o módulo não vê o resgate de ninguém. Supervisor, gerente e
      adm. de loja escrevem em Gamificação pela matriz e, por isso, veem — o
      caso de quem só lê é o do SST.
    */
    const doSst = await request(app)
      .get("/api/reward-redemptions")
      .set(as(sst.token));
    expect(doSst.body.manages).toBe(false);
    expect(
      doSst.body.redemptions.map((r: { id: string }) => r.id),
    ).not.toContain(meu.body.redemption.id);
  });
});

describe("recusar devolve o que foi pago [OB-4]", () => {
  it("os pontos voltam e o prêmio volta ao estoque", async () => {
    const premio = await publicarPremio(`Boné ${SUFIXO}`, 20, 1);
    await darPontos(20);
    const antes = await saldo(colaborador.token);

    const resgate = await request(app)
      .post(`/api/rewards/${premio.id}/redeem`)
      .set(as(colaborador.token));
    expect(resgate.status).toBe(201);

    const depoisDoPedido = await saldo(colaborador.token);
    expect(depoisDoPedido).toBe(antes - 20);
    const semEstoque = await prisma.reward.findUnique({
      where: { id: premio.id },
      select: { stock: true },
    });
    expect(semEstoque?.stock).toBe(0);

    const recusa = await request(app)
      .post(`/api/reward-redemptions/${resgate.body.redemption.id}/decide`)
      .set(as(rh.token))
      .send({ status: "REJECTED" });
    expect(recusa.status, JSON.stringify(recusa.body)).toBe(200);

    expect(await saldo(colaborador.token)).toBe(antes);
    const comEstoque = await prisma.reward.findUnique({
      where: { id: premio.id },
      select: { stock: true },
    });
    expect(comEstoque?.stock).toBe(1);

    // E quem pediu é avisado.
    const aviso = await prisma.notification.findFirst({
      where: {
        entityType: "RewardRedemption",
        entityId: resgate.body.redemption.id,
      },
      select: { userId: true, body: true },
    });
    expect(aviso?.userId).toBe(colaborador.user.id);
    expect(aviso?.body).toContain("pontos voltaram");
  });

  it("recusar duas vezes não devolve duas vezes", async () => {
    const premio = await publicarPremio(`Garrafa ${SUFIXO}`, 15, 1);
    await darPontos(15);
    const antes = await saldo(colaborador.token);
    const resgate = await request(app)
      .post(`/api/rewards/${premio.id}/redeem`)
      .set(as(colaborador.token));

    const uma = await request(app)
      .post(`/api/reward-redemptions/${resgate.body.redemption.id}/decide`)
      .set(as(rh.token))
      .send({ status: "REJECTED" });
    expect(uma.status).toBe(200);

    const outra = await request(app)
      .post(`/api/reward-redemptions/${resgate.body.redemption.id}/decide`)
      .set(as(rh.token))
      .send({ status: "REJECTED" });
    expect(outra.status, JSON.stringify(outra.body)).toBe(409);

    expect(await saldo(colaborador.token)).toBe(antes);
  });

  it("entregue não devolve pontos", async () => {
    const premio = await publicarPremio(`Mochila ${SUFIXO}`, 25, 1);
    await darPontos(25);
    const antes = await saldo(colaborador.token);
    const resgate = await request(app)
      .post(`/api/rewards/${premio.id}/redeem`)
      .set(as(colaborador.token));

    const entrega = await request(app)
      .post(`/api/reward-redemptions/${resgate.body.redemption.id}/decide`)
      .set(as(rh.token))
      .send({ status: "DELIVERED" });
    expect(entrega.status, JSON.stringify(entrega.body)).toBe(200);

    expect(await saldo(colaborador.token)).toBe(antes - 25);
  });

  it("quem não cuida do módulo não decide resgate", async () => {
    const premio = await publicarPremio(`Mouse ${SUFIXO}`, 5, 1);
    await darPontos(5);
    const resgate = await request(app)
      .post(`/api/rewards/${premio.id}/redeem`)
      .set(as(colaborador.token));

    const res = await request(app)
      .post(`/api/reward-redemptions/${resgate.body.redemption.id}/decide`)
      .set(as(colaborador.token))
      .send({ status: "DELIVERED" });
    expect(res.status).toBe(403);
  });
});
