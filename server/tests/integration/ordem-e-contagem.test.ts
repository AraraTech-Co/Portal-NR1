import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O Início e o Painel contam igual, e a ordem avisa quando ficou para trás.
 *
 * O Início contava toda função sem ordem de serviço, inclusive as em que não
 * há ninguém; o Painel e a tela de Ordens contam só as com gente. O dono via
 * 15 pendências numa tela e 4 na outra [B3-4-D]. E a ordem seguia "Emitida ·
 * v1" depois de a função ganhar atividade e risco: o trabalhador dava ciência
 * de uma ordem que não fala do risco que ele corre hoje [CB-69].
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let sst = "";
let unidade = "";
let setor = "";
/** Função com gente e sem ordem: é pendência nas duas telas. */
let funcaoComGente = "";
/** Função vazia e sem ordem: não é pendência em nenhuma. */
let funcaoVazia = "";
/** Função com ordem emitida, que depois recebe atividade e risco. */
let funcaoDaOrdem = "";
let perfilMexido = "";
let funcaoOriginal: string | null = null;
let atividade = "";
let perigo = "";
/** Função cujo inventário mudou ANTES de a ordem ser emitida. */
let funcaoAnterior = "";
let atividadeAnterior = "";
let perigoAnterior = "";

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body.token as string;
}

/** Quantas funções sem ordem o Início mostra. */
async function pendenciaDoInicio() {
  const res = await request(app).get("/api/inicio").set(as(sst));
  expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
  const cartao = (res.body.compliance as { id: string; count: number }[] | null)?.find(
    (c) => c.id === "funcoes_sem_ordem",
  );
  return cartao?.count ?? 0;
}

/** O cartão de ordens do Painel, só com as funções deste teste. */
async function cartaoDoPainel() {
  const res = await request(app)
    .get(`/api/fiscalizacao?establishment_id=${unidade}`)
    .set(as(sst));
  expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
  const c = (res.body.checks as {
    id: string;
    items: { ok: boolean; label: string; detail?: string }[];
  }[]).find((x) => x.id === "ordens_servico");
  expect(c, "o cartão de ordens existe").toBeTruthy();
  return c!;
}

beforeAll(async () => {
  app = createApp();
  sst = await entrar("teste.sst");

  const est = await prisma.establishment.create({
    data: { organizationId: ORG_ID, name: `Unidade da ordem ${SUFIXO}` },
    select: { id: true },
  });
  unidade = est.id;
  const sec = await prisma.sector.create({
    data: { organizationId: ORG_ID, establishmentId: unidade, name: `Setor ${SUFIXO}` },
    select: { id: true },
  });
  setor = sec.id;

  const nomes = [
    `Com gente ${SUFIXO}`,
    `Vazia ${SUFIXO}`,
    `Da ordem ${SUFIXO}`,
    `Mudou antes ${SUFIXO}`,
  ];
  const criadas: string[] = [];
  for (const name of nomes) {
    const f = await prisma.jobRole.create({
      data: { organizationId: ORG_ID, sectorId: setor, name },
      select: { id: true },
    });
    criadas.push(f.id);
  }
  [funcaoComGente, funcaoVazia, funcaoDaOrdem, funcaoAnterior] = criadas;

  // Uma pessoa emprestada do seed, com a função devolvida no fim.
  const perfil = await prisma.employeeProfile.findFirstOrThrow({
    where: { organizationId: ORG_ID, dismissedAt: null, user: { active: true } },
    select: { id: true, jobRoleId: true },
  });
  perfilMexido = perfil.id;
  funcaoOriginal = perfil.jobRoleId;
  await prisma.employeeProfile.update({
    where: { id: perfilMexido },
    data: { jobRoleId: funcaoComGente },
  });
});

afterAll(async () => {
  await prisma.employeeProfile.update({
    where: { id: perfilMexido },
    data: { jobRoleId: funcaoOriginal },
  });
  const funcoes = [funcaoComGente, funcaoVazia, funcaoDaOrdem, funcaoAnterior];
  const atividades = [atividade, atividadeAnterior].filter(Boolean);
  await prisma.serviceOrder.deleteMany({ where: { jobRoleId: { in: funcoes } } });
  await prisma.risk.deleteMany({
    where: { hazard: { activityId: { in: atividades } } },
  });
  await prisma.hazard.deleteMany({
    where: { id: { in: [perigo, perigoAnterior].filter(Boolean) } },
  });
  await prisma.activityJobRole.deleteMany({
    where: { activityId: { in: atividades } },
  });
  await prisma.activity.deleteMany({ where: { id: { in: atividades } } });
  await prisma.jobRole.deleteMany({ where: { id: { in: funcoes } } });
  await prisma.sector.deleteMany({ where: { id: setor } });
  await prisma.establishment.deleteMany({ where: { id: unidade } });
});

describe("o Início conta como o Painel [B3-4-D]", () => {
  it("função sem ninguém não entra na conta de nenhuma das duas telas", async () => {
    const inicio = await pendenciaDoInicio();
    const painel = await cartaoDoPainel();

    const daVazia = painel.items.find((i) => i.label === `Vazia ${SUFIXO}`);
    expect(daVazia, "a função vazia aparece no Painel").toBeTruthy();
    expect(daVazia!.ok, "mas não como pendência").toBe(true);

    /*
      É o defeito do achado: o Início contava as vazias e mostrava um número
      maior que o do Painel.
    */
    const semOrdemComGente = painel.items.filter(
      (i) => !i.ok && (i.detail ?? "").includes("trabalhando sem ordem"),
    ).length;
    expect(semOrdemComGente, "a com gente é pendência no Painel").toBeGreaterThan(0);

    const contagemDasMinhas = await prisma.jobRole.count({
      where: {
        organizationId: ORG_ID,
        archivedAt: null,
        serviceOrders: { none: {} },
        employees: { some: { dismissedAt: null, user: { active: true } } },
      },
    });
    expect(inicio, "o Início usa a mesma regra do Painel").toBe(contagemDasMinhas);
  });
});

describe("a ordem avisa quando ficou para trás [CB-69]", () => {
  it("emitida e sem mudanças, segue em ordem", async () => {
    const res = await request(app)
      .post("/api/service-orders")
      .set(as(sst))
      .send({
        job_role_id: funcaoDaOrdem,
        responsible_name: `Daniel ${SUFIXO}`,
        duties: `Usar a proteção da placa e comunicar falhas ${SUFIXO}`,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const lista = await request(app).get("/api/service-orders").set(as(sst));
    const minha = (lista.body.job_roles as { id: string; current: { changes_since: number } | null }[])
      .find((r) => r.id === funcaoDaOrdem);
    expect(minha?.current, "a ordem foi emitida").toBeTruthy();
    expect(minha!.current!.changes_since, "nada mudou desde a emissão").toBe(0);
  });

  it("mudança ANTES da emissão não conta: a ordem já a contempla", async () => {
    /*
      Sem este caso, tirar o filtro de data do helper não quebra nada — e o
      portal passaria a chamar de desatualizada toda ordem de função com
      qualquer histórico.
    */
    const act = await prisma.activity.create({
      data: {
        organizationId: ORG_ID,
        establishmentId: unidade,
        sectorId: setor,
        name: `Operar prensa ${SUFIXO}`,
      },
      select: { id: true },
    });
    atividadeAnterior = act.id;
    await prisma.activityJobRole.create({
      data: { activityId: atividadeAnterior, jobRoleId: funcaoAnterior },
    });
    const haz = await request(app)
      .post("/api/hazards")
      .set(as(sst))
      .send({
        activity_id: atividadeAnterior,
        description: `Prensa sem proteção ${SUFIXO}`,
        category: "ACCIDENT",
        risks: [{ description: `Esmagamento ${SUFIXO}` }],
      });
    expect(haz.status, JSON.stringify(haz.body)).toBe(201);
    perigoAnterior = haz.body.hazard.id;

    // A ordem sai DEPOIS: ela já contempla o perigo acima.
    const emitida = await request(app)
      .post("/api/service-orders")
      .set(as(sst))
      .send({
        job_role_id: funcaoAnterior,
        responsible_name: `Daniel ${SUFIXO}`,
        duties: `Usar a proteção da prensa ${SUFIXO}`,
      });
    expect(emitida.status, JSON.stringify(emitida.body)).toBe(201);

    const lista = await request(app).get("/api/service-orders").set(as(sst));
    const minha = (lista.body.job_roles as { id: string; current: { changes_since: number } | null }[])
      .find((r) => r.id === funcaoAnterior);
    expect(
      minha!.current!.changes_since,
      "o que mudou antes da emissão já está na ordem",
    ).toBe(0);
  });

  it("mudar o inventário da função depois da emissão marca a ordem", async () => {
    const act = await prisma.activity.create({
      data: {
        organizationId: ORG_ID,
        establishmentId: unidade,
        sectorId: setor,
        name: `Operar torno ${SUFIXO}`,
      },
      select: { id: true },
    });
    atividade = act.id;
    await prisma.activityJobRole.create({
      data: { activityId: atividade, jobRoleId: funcaoDaOrdem },
    });

    const haz = await request(app)
      .post("/api/hazards")
      .set(as(sst))
      .send({
        activity_id: atividade,
        description: `Peça girando sem proteção ${SUFIXO}`,
        category: "ACCIDENT",
        risks: [{ description: `Aprisionamento na placa ${SUFIXO}` }],
      });
    expect(haz.status, JSON.stringify(haz.body)).toBe(201);
    perigo = haz.body.hazard.id;

    const lista = await request(app).get("/api/service-orders").set(as(sst));
    const minha = (lista.body.job_roles as { id: string; current: { changes_since: number } | null }[])
      .find((r) => r.id === funcaoDaOrdem);
    /*
      É o defeito do achado: a ordem seguia "Emitida · v1" depois de a função
      ganhar o risco, sem nada que dissesse que ela ficou para trás.
    */
    expect(minha!.current!.changes_since, "a mudança é contada").toBeGreaterThan(0);

    const painel = await cartaoDoPainel();
    const daOrdem = painel.items.find((i) => i.label === `Da ordem ${SUFIXO}`);
    expect(daOrdem, "a função aparece no Painel").toBeTruthy();
    expect(daOrdem!.detail ?? "").toContain("desatualizada");
  });
});
