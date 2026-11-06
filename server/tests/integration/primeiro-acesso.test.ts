import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import type { Express } from "express";
import { createApp, trustProxySetting } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Primeiro acesso por conferência de dados e limite de tentativas. [C1-7]
 *
 * A planilha cria a conta sem senha conhecida, aguardando o primeiro acesso.
 * A pessoa informa matrícula, CPF e nascimento; se conferirem, recebe uma
 * ficha de ativação de uso único e cria a senha. Erro dá sempre a mesma
 * mensagem. 5 erros seguidos bloqueiam por 15 minutos, no primeiro acesso e
 * no login.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
/* Senhas montadas aqui: nenhuma senha escrita por extenso no repositório. */
const senhaDeTeste = (nome: string) => [nome, "de", "teste", SUFIXO].join("-");
const SENHA_NOVA = senhaDeTeste("nova");
const SENHA_CERTA = senhaDeTeste("certa");
const NEGADO =
  "Os dados não conferem ou o primeiro acesso não está liberado. Procure o RH ou o seu gerente.";

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: { token: string };
let seq = 0;

function cpfFicticio(semente: number): string {
  const base = String(100000000 + (semente % 800000000));
  const digitos = base.split("").map(Number);
  const verificador = (tamanho: number) => {
    const soma = digitos.slice(0, tamanho).reduce((t, d, i) => t + d * (tamanho + 1 - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  digitos.push(verificador(9));
  digitos.push(verificador(10));
  return `${base}${digitos[9]}${digitos[10]}`;
}

type Pessoa = { matricula: string; cpf: string; nascimento: string; login: string; userId: string };

/** Uma pessoa nova pela planilha, aguardando o primeiro acesso. */
async function pessoaNova(): Promise<Pessoa> {
  seq += 1;
  const matricula = `0${seq}${SUFIXO}`.toUpperCase().slice(0, 18);
  const cpf = cpfFicticio(Date.now() + seq * 104729);
  const res = await request(app)
    .post("/api/pessoas-acessos/importar")
    .set(as(rh.token))
    .send({
      people: [
        {
          name: `Primeira Pessoa ${seq} ${SUFIXO}`,
          registration: matricula,
          tax_id: cpf,
          birth_date: "1990-03-15",
        },
      ],
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const linha = res.body.results[0];
  expect(linha.status, JSON.stringify(linha)).toBe("created");
  const user = await prisma.user.findUniqueOrThrow({ where: { login: linha.login } });
  return { matricula, cpf, nascimento: "1990-03-15", login: linha.login, userId: user.id };
}

const conferir = (dados: { matricula: string; cpf: string; nascimento: string }, ip?: string) => {
  const r = request(app).post("/api/auth/primeiro-acesso");
  if (ip) r.set("X-Forwarded-For", ip);
  return r.send(dados);
};

const criarSenha = (token: string, senha = SENHA_NOVA) =>
  request(app)
    .post("/api/auth/primeiro-acesso/senha")
    .send({ token, password: senha, password_confirmation: senha });

const entrar = (login: string, password: string, ip?: string) => {
  const r = request(app).post("/api/auth");
  if (ip) r.set("X-Forwarded-For", ip);
  return r.send({ login, password });
};

beforeAll(async () => {
  app = createApp();
  const res = await request(app).post("/api/auth").send({ login: "teste.rh", password: SENHA });
  expect(res.status).toBe(200);
  rh = res.body;
});

afterEach(() => {
  delete process.env.TRUST_PROXY;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { name: { contains: `Primeira Pessoa` } } });
  await prisma.authLockout.deleteMany({});
});

describe("primeiro acesso [C1-7]", () => {
  it("os três dados certos criam a senha e a pessoa entra; repetir é recusado", async () => {
    const p = await pessoaNova();
    // Com zeros à esquerda e CPF formatado, ainda confere.
    const formatado = `${p.cpf.slice(0, 3)}.${p.cpf.slice(3, 6)}.${p.cpf.slice(6, 9)}-${p.cpf.slice(9)}`;
    const ok = await conferir({ matricula: p.matricula, cpf: formatado, nascimento: "15/03/1990" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(typeof ok.body.token).toBe("string");

    const criou = await criarSenha(ok.body.token);
    expect(criou.status, JSON.stringify(criou.body)).toBe(200);

    const conta = await prisma.user.findUniqueOrThrow({ where: { id: p.userId } });
    expect(conta.activatedAt).not.toBeNull();
    expect(conta.firstAccessUntil).toBeNull();
    expect(conta.mustChangePassword).toBe(false);

    const login = await entrar(p.matricula, SENHA_NOVA);
    expect(login.status, JSON.stringify(login.body)).toBe(200);

    const deNovo = await conferir(p);
    expect(deNovo.status).toBe(400);
    expect(deNovo.body.message).toBe(NEGADO);

    const trilha = await prisma.auditEvent.findFirst({
      where: { entityId: p.userId, action: "user.first_access" },
    });
    expect(trilha).not.toBeNull();
  });

  it("ficha inválida, usada duas vezes ou em dobro ao mesmo tempo é recusada", async () => {
    expect((await criarSenha("ficha-inventada")).body.message).toBe(NEGADO);

    const p = await pessoaNova();
    const ok = await conferir(p);
    const [a, b] = await Promise.all([criarSenha(ok.body.token, senhaDeTeste("aaa")), criarSenha(ok.body.token, senhaDeTeste("bbb"))]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    expect((await criarSenha(ok.body.token)).status).toBe(400);
  });

  it("a ficha vale 10 minutos", async () => {
    const p = await pessoaNova();
    const ok = await conferir(p);
    await prisma.activationToken.updateMany({
      where: { userId: p.userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await criarSenha(ok.body.token)).status).toBe(400);
  });

  it("erro dá sempre a mesma mensagem, sem dizer qual dado errou nem se a matrícula existe", async () => {
    const p = await pessoaNova();
    const respostas = await Promise.all([
      conferir({ ...p, nascimento: "1990-03-16" }),
      conferir({ ...p, cpf: cpfFicticio(Date.now() + 7) }),
      conferir({ ...p, matricula: `NAOEXISTE${SUFIXO}` }),
      conferir({ ...p, cpf: "123" }),
      conferir({ ...p, nascimento: "31/02/1990" }),
    ]);
    for (const r of respostas) {
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ message: NEGADO, code: "FIRST_ACCESS_DENIED" });
    }
  });

  it("conta antiga (não classificada), prazo vencido ou conta já ativada pelo RH: recusa", async () => {
    const antiga = await pessoaNova();
    await prisma.user.update({ where: { id: antiga.userId }, data: { firstAccessEligible: false } });
    expect((await conferir(antiga)).body.message).toBe(NEGADO);

    const vencida = await pessoaNova();
    await prisma.user.update({
      where: { id: vencida.userId },
      data: { firstAccessUntil: new Date(Date.now() - 1000) },
    });
    expect((await conferir(vencida)).body.message).toBe(NEGADO);

    const resetada = await pessoaNova();
    const ficha = await conferir(resetada);
    const reset = await request(app)
      .post(`/api/pessoas-acessos/${resetada.userId}/redefinir-senha`)
      .set(as(rh.token));
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    // O reset revoga a ficha aberta e fecha o primeiro acesso.
    expect((await criarSenha(ficha.body.token)).status).toBe(400);
    expect((await conferir(resetada)).body.message).toBe(NEGADO);
  });

  it("conta já ativada não ativa de novo, mesmo com a janela aberta e elegível", async () => {
    /*
      A regra central: só conta com o marcador vazio ativa sozinha. Hoje toda
      ativação também fecha a janela, e era essa outra regra que barrava; o
      teste põe a janela aberta para provar que o marcador sozinho barra.
    */
    const p = await pessoaNova();
    await prisma.user.update({
      where: { id: p.userId },
      data: { activatedAt: new Date(), firstAccessEligible: true, firstAccessUntil: new Date(Date.now() + 86_400_000) },
    });
    const res = await conferir(p);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(NEGADO);

    // E a ficha emitida antes da ativação também não serve mais.
    const outra = await pessoaNova();
    const ficha = await conferir(outra);
    expect(ficha.status).toBe(200);
    await prisma.user.update({ where: { id: outra.userId }, data: { activatedAt: new Date() } });
    expect((await criarSenha(ficha.body.token)).status).toBe(400);
  });

  it("5 erros bloqueiam a matrícula por 15 minutos; passado o tempo, funciona", async () => {
    const p = await pessoaNova();
    for (let i = 0; i < 5; i++) {
      expect((await conferir({ ...p, nascimento: "2000-01-01" })).status).toBe(400);
    }
    // Agora nem os dados certos passam.
    expect((await conferir(p)).body.message).toBe(NEGADO);

    await prisma.authLockout.updateMany({
      where: { lockedUntil: { not: null } },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    const ok = await conferir(p);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it("nenhum CPF, nascimento ou matrícula digitado fica em claro no registro ou na trilha", async () => {
    const p = await pessoaNova();
    await conferir({ ...p, nascimento: "1977-07-07" });
    const tentativas = await prisma.authAttempt.findMany({
      where: { at: { gte: new Date(Date.now() - 60_000) } },
    });
    const texto = JSON.stringify(tentativas);
    expect(texto).not.toContain(p.cpf);
    // A data inteira, nos dois formatos: "1977" solto aparece por acaso em hash e id.
    expect(texto).not.toContain("1977-07-07");
    expect(texto).not.toContain("07/07/1977");
    expect(texto).not.toContain(p.matricula);
    const trilha = JSON.stringify(
      await prisma.auditEvent.findMany({ where: { createdAt: { gte: new Date(Date.now() - 60_000) } } }),
    );
    expect(trilha).not.toContain(p.cpf);
    expect(trilha).not.toContain("1977-07-07");
  });
});

describe("limite de tentativas no login [C1-7]", () => {
  it("5 senhas erradas bloqueiam por 15 minutos, contando juntos CPF, matrícula e login da mesma conta", async () => {
    const p = await pessoaNova();
    const ok = await conferir(p);
    await criarSenha(ok.body.token, SENHA_CERTA);

    for (const id of [p.cpf, p.matricula, p.login, p.cpf]) {
      expect((await entrar(id, "errada-errada")).status).toBe(401);
    }
    const quinta = await entrar(p.matricula, "errada-errada");
    expect(quinta.status).toBe(429);
    expect(quinta.body.code).toBe("LOGIN_LOCKED");
    expect(quinta.body.message).toMatch(/bloqueado por 15 minutos/);

    // Bloqueado: nem a senha certa entra, por nenhum dos identificadores.
    expect((await entrar(p.login, SENHA_CERTA)).status).toBe(429);

    await prisma.authLockout.updateMany({
      where: { key: `acct:${p.userId}` },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    expect((await entrar(p.login, SENHA_CERTA)).status).toBe(200);
  });

  it("um acerto zera os erros seguidos", async () => {
    const p = await pessoaNova();
    const ok = await conferir(p);
    await criarSenha(ok.body.token, SENHA_CERTA);
    for (let i = 0; i < 4; i++) await entrar(p.login, "errada");
    expect((await entrar(p.login, SENHA_CERTA)).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await entrar(p.login, "errada")).status).toBe(401);
  });

  it("sem TRUST_PROXY, o IP não bloqueia: muitos erros de identificadores diferentes não travam ninguém", async () => {
    for (let i = 0; i < 22; i++) {
      expect((await entrar(`ninguem-${SUFIXO}-${i}`, "x", "203.0.113.9")).status).toBe(401);
    }
    expect((await entrar("teste.rh", SENHA, "203.0.113.9")).status).toBe(200);
  });

  it("com TRUST_PROXY, 20 erros do mesmo IP em 15 minutos bloqueiam o IP", async () => {
    process.env.TRUST_PROXY = "loopback";
    const comProxy = createApp();
    const tentar = (login: string, password: string) =>
      request(comProxy).post("/api/auth").set("X-Forwarded-For", "198.51.100.7").send({ login, password });
    for (let i = 0; i < 19; i++) {
      expect((await tentar(`varredura-${SUFIXO}-${i}`, "x")).status).toBe(401);
    }
    expect((await tentar(`varredura-${SUFIXO}-19`, "x")).status).toBe(429);
    // O IP bloqueado não entra nem com a senha certa; outro IP entra.
    expect((await tentar("teste.rh", SENHA)).status).toBe(429);
    const outro = await request(comProxy)
      .post("/api/auth")
      .set("X-Forwarded-For", "198.51.100.8")
      .send({ login: "teste.rh", password: SENHA });
    expect(outro.status).toBe(200);
  });

  it("TRUST_PROXY=true é recusado: deixaria quem acessa escolher o próprio IP", () => {
    expect(() => trustProxySetting("true")).toThrow();
    expect(trustProxySetting("")).toBe(false);
    expect(trustProxySetting("1")).toBe(1);
    expect(trustProxySetting("loopback")).toBe("loopback");
  });
});

describe("a tela de primeiro acesso abre sem sessão [C1-7]", () => {
  it("a rota fica fora da área que exige login", () => {
    const app = readFileSync(join(__dirname, "../../../client/src/App.tsx"), "utf8")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
      .replace(/\/\*[\s\S]*?\*\//g, " ");
    const rota = app.indexOf('path="/primeiro-acesso"');
    const guarda = app.indexOf("<Route element={<RequireAuth />}>");
    expect(rota, "a rota existe").toBeGreaterThan(0);
    expect(app.indexOf('path="/primeiro-acesso"', rota + 1), "uma vez só").toBe(-1);
    expect(guarda, "a guarda existe").toBeGreaterThan(0);
    expect(rota, "antes da área logada").toBeLessThan(guarda);
  });
});
