import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { accountKey, canonicalRegistration, identifierKey } from "../../src/helper/auth-attempts";

/**
 * Login pela filial. [C3-2b]
 *
 * A tela abre com a escolha da filial, antes da matrícula e da senha. A
 * filial só restringe onde a matrícula e o CPF são procurados; "Externo" é
 * para quem não tem ficha e aceita login, e-mail e CPF. Qualquer divergência
 * dá o mesmo 401 e gasta o mesmo bcrypt (R1); a trava sem conta única é da
 * filial com a matrícula (R2); a rota das filiais não recebe parâmetro
 * (R4); sem empresa resolvida, o Master é avisado (R5).
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SUFIXO = Date.now().toString(36);
const SENHA = ["login", "pela", "filial", SUFIXO].join("-");
const SENHA_SEED = ["teste", "1234"].join("");
/** Matrícula numérica curta (nunca forma CPF) e inédita a cada execução. */
const NUM = String(3_000_000 + (Date.now() % 6_000_000));
const NEGADO_LOGIN = { message: "Credenciais inválidas." };

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: { token: string };
const filiais: string[] = [];
let filialA = "";
let filialB = "";
let filialC = "";
let arquivada = "";
let outraEmpresa = "";
let filialDeOutra = "";

type Pessoa = { login: string; userId: string; cpf: string; matricula: string };
let pa: Pessoa; // matrícula NUM na filial A
let pb: Pessoa; // a mesma matrícula NUM na filial B, outra pessoa

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
  return d.join("");
}

async function pessoa(nome: string, filial: string, matricula: string, ativa = true): Promise<Pessoa> {
  const cpf = cpfFicticio(Date.now() + nome.length * 7919 + Math.floor(Math.random() * 1e6));
  const res = await request(app)
    .post("/api/pessoas-acessos/importar")
    .set(as(rh.token))
    .send({
      people: [
        {
          name: `C32b ${nome} ${SUFIXO}`,
          registration: matricula,
          tax_id: cpf,
          birth_date: "1991-04-20",
          establishment_id: filial,
        },
      ],
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect(res.body.results[0].status, JSON.stringify(res.body.results[0])).toBe("created");
  const login = res.body.results[0].login as string;
  const user = await prisma.user.findUniqueOrThrow({ where: { login }, select: { id: true } });
  if (ativa) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(SENHA, 4), activatedAt: new Date() },
    });
  }
  return { login, userId: user.id, cpf, matricula };
}

const entrar = (login: string, establishment_id?: string, password = SENHA) =>
  request(app).post("/api/auth").send({ login, password, establishment_id });

beforeAll(async () => {
  process.env.LOGIN_ORG_ID = ORG_ID;
  app = createApp();
  const sessao = await request(app).post("/api/auth").send({ login: "teste.rh", password: SENHA_SEED });
  expect(sessao.status).toBe(200);
  rh = sessao.body;

  const nova = async (nome: string, organizationId = ORG_ID) => {
    const est = await prisma.establishment.create({ data: { organizationId, name: `C32b ${nome} ${SUFIXO}` } });
    filiais.push(est.id);
    return est.id;
  };
  filialA = await nova("A");
  filialB = await nova("B");
  filialC = await nova("C");
  arquivada = await nova("Arquivada");
  await prisma.establishment.update({ where: { id: arquivada }, data: { archivedAt: new Date() } });
  outraEmpresa = (await prisma.organization.create({ data: { name: `C32b Outra ${SUFIXO}` } })).id;
  filialDeOutra = await nova("De outra", outraEmpresa);

  pa = await pessoa("pa", filialA, NUM);
  pb = await pessoa("pb", filialB, `0${NUM}`);
});

/** Pessoa gravada direto no banco (para filial arquivada ou de outra empresa). */
async function pessoaDireta(nome: string, organizationId: string, establishmentId: string, matricula: string) {
  const user = await prisma.user.create({
    data: {
      login: `c32b.${nome}.${SUFIXO}`,
      name: `C32b ${nome} ${SUFIXO}`,
      passwordHash: await bcrypt.hash(SENHA, 4),
      activatedAt: new Date(),
    },
  });
  await prisma.membership.create({ data: { userId: user.id, organizationId, role: "COLABORADOR" } });
  await prisma.employeeProfile.create({
    data: { organizationId, userId: user.id, establishmentId, registration: matricula },
  });
  return user;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { name: { startsWith: `C32b ` } } });
  await prisma.establishment.deleteMany({ where: { id: { in: filiais } } });
  await prisma.organization.deleteMany({ where: { id: outraEmpresa } });
  delete process.env.LOGIN_ORG_ID;
});

describe("a rota das filiais da tela de login (R4)", () => {
  it("devolve só id e nome das filiais ativas da empresa do login, sem parâmetro", async () => {
    const res = await request(app).get("/api/auth/filiais");
    expect(res.status).toBe(200);
    const lista = res.body.establishments as Record<string, unknown>[];
    const ids = lista.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining([filialA, filialB, filialC]));
    expect(ids).not.toContain(arquivada);
    expect(ids).not.toContain(filialDeOutra);
    for (const f of lista) expect(Object.keys(f).sort()).toEqual(["id", "name"]);

    // Parâmetro não muda nada: ninguém lista as filiais de outra empresa por id.
    const comParametro = await request(app).get(`/api/auth/filiais?organization_id=${outraEmpresa}`);
    expect(comParametro.body).toEqual(res.body);
  });

  it("sem LOGIN_ORG_ID e com mais de uma empresa ativa, não mostra filial nenhuma e avisa o Master (R5)", async () => {
    delete process.env.LOGIN_ORG_ID;
    try {
      const res = await request(app).get("/api/auth/filiais");
      expect(res.status).toBe(200);
      expect(res.body.establishments).toEqual([]);

      const master = await request(app).post("/api/auth").send({ login: "teste.master", password: SENHA_SEED });
      expect(master.status).toBe(200);
      expect(master.body.user.login_without_establishments).toBe(true);
      const rhAgora = await request(app).post("/api/auth").send({ login: "teste.rh", password: SENHA_SEED });
      expect(rhAgora.body.user.login_without_establishments, "só o Master recebe o aviso").toBeUndefined();

      // Pela matrícula, ninguém entra enquanto isso.
      expect((await entrar(pa.matricula, filialA)).status).toBe(401);
    } finally {
      process.env.LOGIN_ORG_ID = ORG_ID;
    }
    const master = await request(app).post("/api/auth").send({ login: "teste.master", password: SENHA_SEED });
    expect(master.body.user.login_without_establishments).toBe(false);
  });

  it("LOGIN_ORG_ID vazio, como o deploy entrega sem a variável, e uma só empresa ativa: mostra as filiais dela", async () => {
    /*
      O compose grava LOGIN_ORG_ID="" quando o environment não tem a
      variável. Vazio vale como ausente: a tela usa a única empresa ativa.
      O banco de teste tem várias empresas ativas; a consulta das ativas é
      a única coisa simulada aqui. [C3-2]
    */
    const ativas = vi
      .spyOn(prisma.organization, "findMany")
      .mockResolvedValueOnce([{ id: ORG_ID }] as never);
    process.env.LOGIN_ORG_ID = "";
    try {
      const res = await request(app).get("/api/auth/filiais");
      expect(res.status).toBe(200);
      const ids = (res.body.establishments as { id: string }[]).map((f) => f.id);
      expect(ids).toEqual(expect.arrayContaining([filialA, filialB, filialC]));
      expect(ids).not.toContain(filialDeOutra);
      expect(ativas).toHaveBeenCalledTimes(1);
    } finally {
      ativas.mockRestore();
      process.env.LOGIN_ORG_ID = ORG_ID;
    }
  });

  it("LOGIN_ORG_ID que não é empresa ativa também não mostra filial", async () => {
    process.env.LOGIN_ORG_ID = randomUUID();
    try {
      expect((await request(app).get("/api/auth/filiais")).body.establishments).toEqual([]);
    } finally {
      process.env.LOGIN_ORG_ID = ORG_ID;
    }
  });
});

describe("o que cada escolha aceita (R3)", () => {
  it("a mesma matrícula em duas filiais: cada filial leva à sua pessoa", async () => {
    const naA = await entrar(NUM, filialA);
    expect(naA.status, JSON.stringify(naA.body)).toBe(200);
    expect(naA.body.user.login).toBe(pa.login);
    const naB = await entrar(`000${NUM}`, filialB);
    expect(naB.status, JSON.stringify(naB.body)).toBe(200);
    expect(naB.body.user.login).toBe(pb.login);
  });

  it("com filial: matrícula ou CPF dessa filial; login e e-mail não", async () => {
    expect((await entrar(pa.cpf, filialA)).status).toBe(200);
    const recusas = [
      await entrar(pa.cpf, filialB), // CPF de outra filial
      await entrar(pa.login, filialA), // login vai por Externo
      await entrar(NUM, filialC), // matrícula que não existe nesta filial
      await entrar(NUM, arquivada), // filial arquivada
      await entrar(NUM, filialDeOutra), // filial de outra empresa
      await entrar(NUM, randomUUID()), // filial que não existe
      await entrar(NUM, filialA, "senha-errada-mesmo"),
    ];
    for (const r of recusas) {
      expect(r.status).toBe(401);
      expect(r.body, "a mesma resposta para qualquer divergência").toEqual(NEGADO_LOGIN);
    }
  });

  it("filial arquivada ou de outra empresa não serve para entrar, nem com a senha certa", async () => {
    // A ficha nasce na filial e a filial é arquivada depois.
    const est = await prisma.establishment.create({ data: { organizationId: ORG_ID, name: `C32b Fechada ${SUFIXO}` } });
    filiais.push(est.id);
    await pessoaDireta("fechada", ORG_ID, est.id, `5${NUM}`);
    await prisma.establishment.update({ where: { id: est.id }, data: { archivedAt: new Date() } });
    const naFechada = await entrar(`5${NUM}`, est.id);
    expect(naFechada.status).toBe(401);
    expect(naFechada.body).toEqual(NEGADO_LOGIN);

    await pessoaDireta("de-outra", outraEmpresa, filialDeOutra, `4${NUM}`);
    const naOutra = await entrar(`4${NUM}`, filialDeOutra);
    expect(naOutra.status).toBe(401);
    expect(naOutra.body).toEqual(NEGADO_LOGIN);
  });

  it("Externo: login e CPF entram; matrícula que não é login de ninguém é recusada", async () => {
    const porLogin = await entrar(pa.login, "externo");
    expect(porLogin.status).toBe(200);
    expect((await entrar(pa.login)).status, "sem filial é Externo").toBe(200);
    expect((await entrar(pa.cpf, "externo")).status).toBe(200);
    const porMatricula = await entrar(NUM, "externo");
    expect(porMatricula.status).toBe(401);
    expect(porMatricula.body).toEqual(NEGADO_LOGIN);

    /*
      Login que é só dígitos (o convite usa a matrícula como login) entra por
      Externo: quem não tem filial na ficha (RH, SST, gestores) não tinha por
      onde entrar. Decisão D4-1 do Léo. [C4-1]
    */
    /* Uma conta como a do convite: o login é o número. */
    const digitos = await pessoa("digitos", filialA, `3${NUM}`);
    await prisma.user.update({ where: { id: digitos.userId }, data: { login: `2${NUM}` } });
    const r = await entrar(`2${NUM}`, "externo");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const errada = await request(app).post("/api/auth").send({ login: `2${NUM}`, password: "senha-errada-1", establishment_id: "externo" });
    expect(errada.status).toBe(401);
    expect(errada.body).toEqual(NEGADO_LOGIN);
  });

  it("primeiro acesso: só na filial da ficha; Externo não tem primeiro acesso", async () => {
    const nova = await pessoa("primeiro", filialC, `7${NUM}`, false);
    const dados = { matricula: `7${NUM}`, cpf: nova.cpf, nascimento: "1991-04-20" };
    const NEGADO =
      "Os dados não conferem ou o primeiro acesso não está liberado. Procure o RH ou o seu gerente.";
    for (const establishment_id of [filialA, "externo", undefined, randomUUID()]) {
      const r = await request(app).post("/api/auth/primeiro-acesso").send({ ...dados, establishment_id });
      expect(r.status, String(establishment_id)).toBe(400);
      expect(r.body.message).toBe(NEGADO);
    }
    const certa = await request(app)
      .post("/api/auth/primeiro-acesso")
      .send({ ...dados, establishment_id: filialC });
    expect(certa.status, JSON.stringify(certa.body)).toBe(200);
    expect(typeof certa.body.token).toBe("string");
  });
});

describe("o tempo de resposta não diz quem existe (R1)", () => {
  it("sem ninguém para comparar, o bcrypt roda mesmo assim", async () => {
    const inativa = await pessoa("inativa", filialA, `8${NUM}`);
    await prisma.user.update({ where: { id: inativa.userId }, data: { active: false } });

    const comparar = vi.spyOn(bcrypt, "compare");
    try {
      const casos: [string, string | undefined][] = [
        [NUM, filialC], // filial errada
        [`9${NUM}`, filialA], // matrícula que não existe
        [`8${NUM}`, filialA], // conta inativa
        [NUM, randomUUID()], // filial que não existe
        [NUM, "externo"], // matrícula em Externo, que não é login de ninguém
        [`ninguem.${SUFIXO}`, undefined], // login que não existe
      ];
      for (const [login, filial] of casos) {
        comparar.mockClear();
        const r = await entrar(login, filial);
        expect(r.status, `${login} @ ${filial}`).toBe(401);
        expect(comparar.mock.calls.length, `bcrypt para ${login} @ ${filial}`).toBeGreaterThanOrEqual(1);
      }
    } finally {
      comparar.mockRestore();
    }
  });
});

describe("a trava não revela a filial (R2)", () => {
  /** 5 erros: 4 recusas e o bloqueio. */
  async function sequencia(login: string, filial: string) {
    const out: number[] = [];
    for (let i = 0; i < 5; i++) out.push((await entrar(login, filial, `errada-${i}`)).status);
    return out;
  }

  it("filial certa ou errada dão a mesma sequência, e travar numa não muda a outra", async () => {
    const MATRICULA = `6${NUM}`;
    const dona = await pessoa("trava", filialB, MATRICULA);

    /* Só as chaves deste teste: outros arquivos rodam ao mesmo tempo. */
    const chaves = [
      accountKey(dona.userId),
      ...[filialA, filialB, filialC].map((f) => identifierKey(`filial:${f}:${canonicalRegistration(MATRICULA)}`)),
      identifierKey(MATRICULA),
    ];
    const limpar = () => prisma.authLockout.deleteMany({ where: { key: { in: chaves } } });
    await limpar();

    // Trava a matrícula numa filial onde ela não existe.
    expect(await sequencia(MATRICULA, filialA)).toEqual([401, 401, 401, 401, 429]);
    // Na filial certa e numa terceira errada, a primeira tentativa ainda é recusa comum.
    expect((await entrar(MATRICULA, filialB, "errada")).status).toBe(401);
    expect((await entrar(MATRICULA, filialC, "errada")).status).toBe(401);
    await limpar();

    // E a filial certa dá exatamente a mesma sequência que a errada.
    expect(await sequencia(MATRICULA, filialB)).toEqual([401, 401, 401, 401, 429]);
    await limpar();
  });
});
