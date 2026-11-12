import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { accountKey } from "../../src/helper/auth-attempts";

/**
 * Painel de ativação e as ações sobre ele. [C1-7]
 *
 * Master, Dono e RH veem e agem; o gerente só vê, na unidade dele [C3-5]; os outros
 * não veem. Uma situação por pessoa. "Reabrir primeiro acesso" só vale para
 * conta nunca ativada e já elegível; conta antiga precisa de classificação
 * com justificativa antes, e "nunca entrou" é recusado quando a trilha
 * registra entrada.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: { token: string };
let gerente: { token: string };
let colaborador: { token: string };
let seq = 0;

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string };
}

function cpfFicticio(semente: number): string {
  const base = String(100000000 + (semente % 800000000));
  const d = base.split("").map(Number);
  const v = (t: number) => {
    const soma = d.slice(0, t).reduce((acc, x, i) => acc + x * (t + 1 - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  d.push(v(9));
  d.push(v(10));
  return `${base}${d[9]}${d[10]}`;
}

/** Pessoa nova pela planilha; `dados=false` deixa sem CPF e nascimento. */
async function pessoa(dados = true): Promise<string> {
  seq += 1;
  const res = await request(app)
    .post("/api/pessoas-acessos/importar")
    .set(as(rh.token))
    .send({
      people: [
        {
          /* A organização de teste tem mais de uma filial. [C3-3] */
          establishment_id: "aaaaaaaa-0001-4000-8000-000000000011",
          name: `Painel Pessoa ${seq} ${SUFIXO}`,
          registration: `PA${seq}${SUFIXO}`.slice(0, 18),
          ...(dados
            ? { birth_date: "1988-08-08", tax_id: cpfFicticio(Date.now() + seq * 7919) }
            : {}),
        },
      ],
    });
  expect(res.status, `importar: ${res.status} ${JSON.stringify(res.body)}`).toBe(201);
  expect(res.body.results[0].status, JSON.stringify(res.body)).toBe("created");
  const u = await prisma.user.findUniqueOrThrow({ where: { login: res.body.results[0].login } });
  return u.id;
}

async function painel(token: string) {
  const res = await request(app).get("/api/pessoas-acessos/ativacao").set(as(token));
  return res;
}

async function situacao(userId: string) {
  const res = await painel(rh.token);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.people.find((p: { userId: string }) => p.userId === userId)?.situation;
}

beforeAll(async () => {
  app = createApp();
  rh = await entrar("teste.rh");
  gerente = await entrar("teste.gerente");
  colaborador = await entrar("teste.colaborador");
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { name: { contains: `Painel Pessoa` } } });
});

describe("quem vê o painel [C1-7]", () => {
  /* O gerente vê só a unidade que gere: `ativacao-na-unidade.test.ts`. [C3-5] */
  it("RH vê e age; gerente só vê; colaborador não vê", async () => {
    const doRh = await painel(rh.token);
    expect(doRh.status).toBe(200);
    expect(doRh.body.can_act).toBe(true);
    expect(Array.isArray(doRh.body.totals_by_unit)).toBe(true);

    const doGerente = await painel(gerente.token);
    expect(doGerente.status).toBe(200);
    expect(doGerente.body.can_act).toBe(false);

    expect((await painel(colaborador.token)).status).toBe(403);

    const id = await pessoa();
    const agir = await request(app)
      .post(`/api/pessoas-acessos/${id}/reabrir-primeiro-acesso`)
      .set(as(gerente.token));
    expect(agir.status).toBe(403);
  });
});

describe("situação de cada pessoa [C1-7]", () => {
  it("aguardando, sem dados, prazo vencido, bloqueado, ativo e legado", async () => {
    const aguardando = await pessoa();
    expect(await situacao(aguardando)).toBe("AWAITING");

    const semDados = await pessoa(false);
    expect(await situacao(semDados)).toBe("MISSING_DATA");

    const vencida = await pessoa();
    await prisma.user.update({ where: { id: vencida }, data: { firstAccessUntil: new Date(Date.now() - 1000) } });
    expect(await situacao(vencida)).toBe("WINDOW_EXPIRED");

    const bloqueada = await pessoa();
    await prisma.authLockout.create({
      data: { key: accountKey(bloqueada), failures: 0, lockedUntil: new Date(Date.now() + 600_000) },
    });
    expect(await situacao(bloqueada)).toBe("BLOCKED");

    const ativa = await pessoa();
    await prisma.user.update({ where: { id: ativa }, data: { activatedAt: new Date() } });
    expect(await situacao(ativa)).toBe("ACTIVE");

    const legado = await pessoa();
    await prisma.user.update({
      where: { id: legado },
      data: { firstAccessEligible: false, firstAccessUntil: null },
    });
    expect(await situacao(legado)).toBe("LEGACY_UNCLASSIFIED");
  });
});

describe("senha provisória [C4-7]", () => {
  it("redefinida pelo RH, aparece como senha provisória; trocada pela pessoa, como ativa", async () => {
    const id = await pessoa();
    const reset = await request(app)
      .post(`/api/pessoas-acessos/${id}/redefinir-senha`)
      .set(as(rh.token))
      .send({});
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    expect(await situacao(id)).toBe("TEMP_PASSWORD");

    const login = (await prisma.user.findUniqueOrThrow({ where: { id } })).login;
    const entrou = await request(app).post("/api/auth").send({ login, password: reset.body.temporary_password });
    expect(entrou.status, JSON.stringify(entrou.body)).toBe(200);
    const nova = ["Nova", "Senha", "C47", SUFIXO].join("-");
    const troca = await request(app)
      .post("/api/auth/password")
      .set(as(entrou.body.token))
      .send({ current_password: reset.body.temporary_password, new_password: nova, new_password_confirmation: nova });
    expect(troca.status, JSON.stringify(troca.body)).toBe(200);
    expect(await situacao(id)).toBe("ACTIVE");
  });
});

describe("reabrir e classificar [C1-7]", () => {
  it("reabrir: dá 30 dias e desbloqueia; conta ativada ou legado não classificado é recusado", async () => {
    const id = await pessoa();
    await prisma.user.update({ where: { id }, data: { firstAccessUntil: new Date(Date.now() - 1000) } });
    await prisma.authLockout.create({
      data: { key: accountKey(id), failures: 0, lockedUntil: new Date(Date.now() + 600_000) },
    });
    const ok = await request(app)
      .post(`/api/pessoas-acessos/${id}/reabrir-primeiro-acesso`)
      .set(as(rh.token));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(await situacao(id)).toBe("AWAITING");
    expect(await prisma.authLockout.count({ where: { key: accountKey(id) } })).toBe(0);
    expect(
      await prisma.auditEvent.count({ where: { entityId: id, action: "user.first_access_reopened" } }),
    ).toBe(1);

    const ativa = await pessoa();
    await prisma.user.update({ where: { id: ativa }, data: { activatedAt: new Date() } });
    expect(
      (await request(app).post(`/api/pessoas-acessos/${ativa}/reabrir-primeiro-acesso`).set(as(rh.token)))
        .status,
    ).toBe(409);

    const legado = await pessoa();
    await prisma.user.update({ where: { id: legado }, data: { firstAccessEligible: false } });
    expect(
      (await request(app).post(`/api/pessoas-acessos/${legado}/reabrir-primeiro-acesso`).set(as(rh.token)))
        .status,
    ).toBe(409);
  });

  it("classificar exige justificativa; 'nunca entrou' libera, 'já usa' marca ativa", async () => {
    const nunca = await pessoa();
    const usa = await pessoa();
    for (const id of [nunca, usa]) {
      await prisma.user.update({
        where: { id },
        data: { firstAccessEligible: false, firstAccessUntil: null },
      });
    }
    const semMotivo = await request(app)
      .post(`/api/pessoas-acessos/${nunca}/classificar`)
      .set(as(rh.token))
      .send({ outcome: "NEVER_SIGNED_IN", reason: "  " });
    expect(semMotivo.status).toBe(400);
    expect(semMotivo.body.field).toBe("reason");

    const libera = await request(app)
      .post(`/api/pessoas-acessos/${nunca}/classificar`)
      .set(as(rh.token))
      .send({ outcome: "NEVER_SIGNED_IN", reason: "Conferido com a pessoa: nunca entrou." });
    expect(libera.status, JSON.stringify(libera.body)).toBe(200);
    expect(await situacao(nunca)).toBe("AWAITING");

    const marca = await request(app)
      .post(`/api/pessoas-acessos/${usa}/classificar`)
      .set(as(rh.token))
      .send({ outcome: "IN_USE", reason: "Usa o portal todo dia." });
    expect(marca.status).toBe(200);
    expect(await situacao(usa)).toBe("ACTIVE");

    const trilha = await prisma.auditEvent.findFirst({
      where: { entityId: usa, action: "user.legacy_classified" },
    });
    expect(trilha?.after).toMatchObject({ outcome: "IN_USE", reason: "Usa o portal todo dia." });

    // Já classificada: não se classifica de novo.
    expect(
      (
        await request(app)
          .post(`/api/pessoas-acessos/${usa}/classificar`)
          .set(as(rh.token))
          .send({ outcome: "NEVER_SIGNED_IN", reason: "Mudei de ideia." })
      ).status,
    ).toBe(409);
  });

  it("'nunca entrou' é recusado quando a trilha registra entrada", async () => {
    const id = await pessoa();
    await prisma.user.update({ where: { id }, data: { firstAccessEligible: false, firstAccessUntil: null } });
    await prisma.auditEvent.create({
      data: {
        organizationId: ORG_ID,
        actorId: id,
        action: "session.signin",
        entityType: "User",
        entityId: id,
      },
    });
    const res = await request(app)
      .post(`/api/pessoas-acessos/${id}/classificar`)
      .set(as(rh.token))
      .send({ outcome: "NEVER_SIGNED_IN", reason: "Achei que nunca tinha entrado." });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("HAS_SIGNIN");
    const u = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(u.firstAccessEligible).toBe(false);
  });
});

describe("a conta é uma só para todas as empresas [C1-7]", () => {
  let outra: string;

  beforeAll(async () => {
    outra = (await prisma.organization.create({ data: { name: `Empresa B ${SUFIXO}` } })).id;
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { organizationId: outra } });
    await prisma.organization.deleteMany({ where: { id: outra } });
  });

  it("com vínculo ativo em outra empresa, nem 'nunca entrou' nem reabrir: o caminho é o reset", async () => {
    const id = await pessoa();
    await prisma.user.update({ where: { id }, data: { firstAccessEligible: false, firstAccessUntil: null } });
    await prisma.membership.create({ data: { userId: id, organizationId: outra, role: "COLABORADOR" } });

    const classificar = await request(app)
      .post(`/api/pessoas-acessos/${id}/classificar`)
      .set(as(rh.token))
      .send({ outcome: "NEVER_SIGNED_IN", reason: "Aqui ela nunca entrou." });
    expect(classificar.status, JSON.stringify(classificar.body)).toBe(409);
    expect(classificar.body.code).toBe("OTHER_ORG");

    // Mesmo já elegível (conta nova), reabrir também é recusado.
    await prisma.user.update({ where: { id }, data: { firstAccessEligible: true } });
    const reabrir = await request(app)
      .post(`/api/pessoas-acessos/${id}/reabrir-primeiro-acesso`)
      .set(as(rh.token));
    expect(reabrir.status).toBe(409);
    expect(reabrir.body.code).toBe("OTHER_ORG");

    const u = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(u.firstAccessUntil).toBeNull();
  });

  it("entrada só pela outra empresa desmente 'nunca entrou', e o painel a mostra", async () => {
    const id = await pessoa();
    await prisma.user.update({ where: { id }, data: { firstAccessEligible: false, firstAccessUntil: null } });
    // Vínculo encerrado lá (não conta como ativo), mas a entrada ficou na trilha de lá.
    await prisma.membership.create({
      data: { userId: id, organizationId: outra, role: "COLABORADOR", suspendedAt: new Date() },
    });
    await prisma.auditEvent.create({
      data: { organizationId: outra, actorId: id, action: "session.signin", entityType: "User", entityId: id },
    });

    const res = await request(app)
      .post(`/api/pessoas-acessos/${id}/classificar`)
      .set(as(rh.token))
      .send({ outcome: "NEVER_SIGNED_IN", reason: "Aqui ela nunca entrou." });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe("HAS_SIGNIN");

    const linha = (await painel(rh.token)).body.people.find((p: { userId: string }) => p.userId === id);
    expect(linha.lastSigninAt).not.toBeNull();
  });
});
