import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Entrar e ser cadastrado.
 *
 * O trabalhador entra pela matrícula e pelo CPF, não só por um login que
 * nunca viu [B2-1-F]; o convite deixa de exigir e-mail [OB-1] e de deixar a
 * própria pessoa escolher matrícula e vínculo, que passam para quem
 * aprova [S1-M] [S1-Q]; e a planilha completa a ficha de quem já existe, sem
 * sobrescrever nada [CB-2] [S1-G].
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

/** CPF válido e inédito a cada execução. */
function cpfFicticio(semente: number): string {
  const base = String(100000000 + (semente % 800000000));
  const digitos = base.split("").map(Number);
  const verificador = (tamanho: number) => {
    const soma = digitos
      .slice(0, tamanho)
      .reduce((total, d, i) => total + d * (tamanho + 1 - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = verificador(9);
  digitos.push(d1);
  const d2 = verificador(10);
  return `${base}${d1}${d2}`;
}

let app: Express;
let master: { token: string; user: { id: string } };
let rh: { token: string; user: { id: string } };
const criados: string[] = [];
const pedidos: string[] = [];
const links: string[] = [];

/*
  A filial vem primeiro na entrada (C3-2b): matrícula e CPF vão com a
  filial; login e e-mail, com "externo" (o padrão aqui).
*/
let FILIAL = "";
async function entrar(login: string, senha = SENHA, filial = "externo") {
  return request(app).post("/api/auth").send({ login, password: senha, establishment_id: filial });
}

/** Cria gente pela planilha e guarda para limpar no fim. */
async function importar(linhas: Record<string, unknown>[], dryRun = false) {
  const res = await request(app)
    .post("/api/pessoas-acessos/importar")
    .set(as(rh.token))
    /*
      A organização de teste tem mais de uma filial: a linha sem função diz
      qual (a do seed, a mesma das funções do seed); com função, vale a dela. [C3-3]
    */
    .send({
      people: linhas.map((l) =>
        l.job_role_id ? l : { establishment_id: "aaaaaaaa-0001-4000-8000-000000000011", ...l },
      ),
      dry_run: dryRun,
    });
  if (!dryRun && res.status === 201) {
    for (const r of res.body.results as { login?: string }[]) {
      if (!r.login) continue;
      const u = await prisma.user.findFirst({ where: { login: r.login }, select: { id: true } });
      if (u && !criados.includes(u.id)) criados.push(u.id);
    }
  }
  return res;
}

beforeAll(async () => {
  process.env.LOGIN_ORG_ID = ORG_ID;
  FILIAL = (
    await prisma.establishment.create({ data: { organizationId: ORG_ID, name: `Filial entrada ${SUFIXO}` } })
  ).id;
  app = createApp();
  master = (await entrar("teste.master")).body;
  rh = (await entrar("teste.rh")).body;
});

afterAll(async () => {
  await prisma.accountJoinRequest.deleteMany({ where: { id: { in: pedidos } } });
  await prisma.user.deleteMany({ where: { id: { in: criados } } });
  await prisma.accountInviteLink.deleteMany({ where: { id: { in: links } } });
  await prisma.establishment.delete({ where: { id: FILIAL } });
  delete process.env.LOGIN_ORG_ID;
});

describe("o trabalhador entra pelo que ele sabe de cor [B2-1-F]", () => {
  it("matrícula e CPF entram, além do login", async () => {
    const cpf = cpfFicticio(Date.now());
    const matricula = `M${SUFIXO}`.slice(0, 12);
    const criar = await importar([
      {
        name: `Pereira Entrada ${SUFIXO}`,
        registration: matricula,
        tax_id: cpf,
        establishment_id: FILIAL,
      },
    ]);
    expect(criar.status, JSON.stringify(criar.body)).toBe(201);
    const linha = criar.body.results[0] as { status: string; login: string };
    expect(linha.status).toBe("created");

    /*
      A planilha não gera mais senha [C1-7]: a senha aqui é posta direto no
      banco, como se a pessoa já tivesse feito o primeiro acesso.
    */
    const senha = ["senha", "do", "teste", SUFIXO].join("-");
    await prisma.user.update({
      where: { login: linha.login },
      data: { passwordHash: await bcrypt.hash(senha, 4), activatedAt: new Date() },
    });

    // Pelo login gerado, como sempre funcionou.
    expect((await entrar(linha.login, senha)).status).toBe(200);
    // Pela matrícula, que é o número que ele usa na fábrica.
    const porMatricula = await entrar(matricula, senha, FILIAL);
    expect(porMatricula.status, "matrícula entra").toBe(200);
    expect(porMatricula.body.user.login).toBe(linha.login);
    // E pelo CPF, formatado como ele costuma escrever.
    const formatado = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
    const porCpf = await entrar(formatado, senha, FILIAL);
    expect(porCpf.status, "CPF entra").toBe(200);
    expect(porCpf.body.user.login).toBe(linha.login);
  });

  it("matrícula certa com senha errada continua sendo recusada", async () => {
    const matricula = `N${SUFIXO}`.slice(0, 12);
    const criar = await importar([
      { name: `Souza Senha ${SUFIXO}`, registration: matricula, establishment_id: FILIAL },
    ]);
    expect(criar.status).toBe(201);

    const res = await entrar(matricula, "senha-errada-mesmo", FILIAL);
    expect(res.status).toBe(401);
  });

  it("zero à esquerda da matrícula não muda quem entra [C3-1]", async () => {
    // Números curtos e inéditos: nunca formam CPF (11 dígitos).
    const n = 1_000_000 + (Date.now() % 8_000_000);
    const comZeros = `000${n}`;
    const semZeros = String(n + 1);
    const senha = ["senha", "zeros", SUFIXO].join("-");

    const criar = await importar([
      { name: `Lima Zeros ${SUFIXO}`, registration: comZeros, establishment_id: FILIAL },
      { name: `Rocha Zeros ${SUFIXO}`, registration: semZeros, establishment_id: FILIAL },
    ]);
    expect(criar.status, JSON.stringify(criar.body)).toBe(201);
    const [a, b] = criar.body.results as { status: string; login: string }[];
    expect([a.status, b.status]).toEqual(["created", "created"]);
    for (const login of [a.login, b.login]) {
      await prisma.user.update({
        where: { login },
        data: { passwordHash: await bcrypt.hash(senha, 4), activatedAt: new Date() },
      });
    }

    // Cadastrada com zeros, digitada sem eles ou com outra quantidade.
    for (const digitado of [String(n), `0${n}`, comZeros, `00000${n}`]) {
      const res = await entrar(digitado, senha, FILIAL);
      expect(res.status, `matrícula ${digitado}`).toBe(200);
      expect(res.body.user.login).toBe(a.login);
    }
    // Cadastrada sem zeros, digitada com eles.
    const res = await entrar(`00${semZeros}`, senha, FILIAL);
    expect(res.status, "zeros só no que foi digitado").toBe(200);
    expect(res.body.user.login).toBe(b.login);

    // Outro número continua outro número: os zeros só saem da frente.
    expect((await entrar(`${n}0`, senha, FILIAL)).status).toBe(401);
    expect((await entrar(`${comZeros}`, "senha-errada-mesmo", FILIAL)).status).toBe(401);
  });

  it("número que não é matrícula de ninguém é recusado", async () => {
    const res = await entrar("99999999", "qualquer-coisa");
    expect(res.status).toBe(401);
  });
});

describe("o convite pede só o que é de quem entra [OB-1] [S1-M] [S1-Q]", () => {
  async function linkDeConvite() {
    const res = await request(app)
      .post("/api/invite-links")
      .set(as(master.token))
      .send({ label: `Convite ${SUFIXO}`, role_mode: "ON_APPROVE" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    links.push(res.body.link.id);
    return res.body.link.path.split("/").pop() as string;
  }

  it("entra sem e-mail e sem matrícula", async () => {
    const token = await linkDeConvite();
    const res = await request(app)
      .post(`/api/invites/${token}`)
      .send({ name: `Sem Email ${SUFIXO}`, password: "senha-boa-123" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    pedidos.push(res.body.request_id);

    const pedido = await prisma.accountJoinRequest.findFirstOrThrow({
      where: { id: res.body.request_id },
      select: { email: true, registration: true, isExternal: true },
    });
    expect(pedido.email).toBeNull();
    expect(pedido.registration, "não é a pessoa que escolhe").toBeNull();
    expect(pedido.isExternal).toBe(false);
  });

  it("a matrícula que a pessoa mandar é ignorada", async () => {
    const token = await linkDeConvite();
    const res = await request(app)
      .post(`/api/invites/${token}`)
      .send({
        name: `Tentou Matricula ${SUFIXO}`,
        password: "senha-boa-123",
        registration: "0001",
        is_external: true,
      });
    expect(res.status).toBe(201);
    pedidos.push(res.body.request_id);

    const pedido = await prisma.accountJoinRequest.findFirstOrThrow({
      where: { id: res.body.request_id },
      select: { registration: true, isExternal: true },
    });
    expect(pedido.registration).toBeNull();
    expect(pedido.isExternal).toBe(false);
  });

  it("quem aprova define a matrícula, e ela vira o login", async () => {
    const token = await linkDeConvite();
    const pedido = await request(app)
      .post(`/api/invites/${token}`)
      .send({ name: `Aprovado Com Matricula ${SUFIXO}`, password: "senha-boa-123" });
    expect(pedido.status).toBe(201);
    pedidos.push(pedido.body.request_id);

    const matricula = `A${SUFIXO}`.slice(0, 12);
    const decisao = await request(app)
      .post(`/api/join-requests/${pedido.body.request_id}/decide`)
      .set(as(master.token))
      .send({ action: "approve", org_role: Role.COLABORADOR, registration: matricula });
    expect(decisao.status, JSON.stringify(decisao.body)).toBe(200);

    const user = await prisma.user.findFirstOrThrow({
      where: { name: `Aprovado Com Matricula ${SUFIXO}` },
      select: { id: true, login: true, email: true },
    });
    criados.push(user.id);
    expect(user.email, "entrou sem e-mail").toBeNull();
    expect(user.login).toBe(matricula.toLowerCase());

    const ficha = await prisma.employeeProfile.findFirstOrThrow({
      where: { organizationId: ORG_ID, userId: user.id },
      select: { registration: true },
    });
    expect(ficha.registration).toBe(matricula);

    // E ele entra pela matrícula que o RH deu.
    expect((await entrar(matricula, "senha-boa-123")).status).toBe(200);
  });

  it("quem aprova marca externo, e aí não há matrícula", async () => {
    const token = await linkDeConvite();
    const pedido = await request(app)
      .post(`/api/invites/${token}`)
      .send({ name: `Terceiro ${SUFIXO}`, password: "senha-boa-123" });
    pedidos.push(pedido.body.request_id);

    const decisao = await request(app)
      .post(`/api/join-requests/${pedido.body.request_id}/decide`)
      .set(as(master.token))
      .send({
        action: "approve",
        org_role: Role.COLABORADOR,
        is_external: true,
        registration: "deveria-ser-ignorada",
      });
    expect(decisao.status, JSON.stringify(decisao.body)).toBe(200);

    const user = await prisma.user.findFirstOrThrow({
      where: { name: `Terceiro ${SUFIXO}` },
      select: { id: true },
    });
    criados.push(user.id);
    const ficha = await prisma.employeeProfile.findFirstOrThrow({
      where: { organizationId: ORG_ID, userId: user.id },
      select: { registration: true },
    });
    expect(ficha.registration, "externo não tem matrícula da empresa").toBeNull();
  });
});

describe("a planilha completa quem já existe [CB-2] [S1-G]", () => {
  it("preenche o que está em branco e não toca no que já tem", async () => {
    const matricula = `C${SUFIXO}`.slice(0, 12);
    // Entra sem CPF, sem função e sem admissão.
    const primeira = await importar([
      { name: `Marcos Incompleto ${SUFIXO}`, registration: matricula },
    ]);
    expect(primeira.status).toBe(201);
    const login = primeira.body.results[0].login as string;

    const antes = await prisma.employeeProfile.findFirstOrThrow({
      where: { organizationId: ORG_ID, user: { login } },
      select: { id: true, taxId: true, jobRoleId: true, admittedAt: true, registration: true },
    });
    expect(antes.taxId).toBeNull();
    expect(antes.jobRoleId).toBeNull();

    /* Uma função da filial em que a pessoa entrou (a do seed). [C3-3] */
    const funcao = await prisma.jobRole.findFirstOrThrow({
      where: {
        organizationId: ORG_ID,
        archivedAt: null,
        sector: { establishmentId: "aaaaaaaa-0001-4000-8000-000000000011" },
      },
      select: { id: true, name: true },
    });
    const cpf = cpfFicticio(Date.now() + 104729);

    // A mesma pessoa, agora com o quadro completo do RH.
    const segunda = await importar([
      {
        name: `Marcos Incompleto ${SUFIXO}`,
        registration: matricula,
        tax_id: cpf,
        job_role_id: funcao.id,
        admitted_at: "2024-03-11",
      },
    ]);
    expect(segunda.status).toBe(201);
    const linha = segunda.body.results[0] as { status: string; filled: string[]; message: string };
    expect(linha.status, "deixou de ser pulada").toBe("completed");
    expect(linha.filled).toEqual(expect.arrayContaining(["CPF", "função", "admissão"]));
    expect(segunda.body.completed).toBe(1);

    const depois = await prisma.employeeProfile.findFirstOrThrow({
      where: { id: antes.id },
      select: { taxId: true, jobRoleId: true, admittedAt: true, registration: true },
    });
    expect(depois.taxId).toBe(cpf);
    expect(depois.jobRoleId).toBe(funcao.id);
    expect(String(depois.admittedAt).slice(0, 10)).not.toBe("null");
    expect(depois.registration, "a matrícula que já estava não muda").toBe(
      antes.registration,
    );
  });

  it("não sobrescreve o que já está preenchido", async () => {
    const matricula = `D${SUFIXO}`.slice(0, 12);
    const cpfBom = cpfFicticio(Date.now() + 15485863);
    const primeira = await importar([
      { name: `Ana Completa ${SUFIXO}`, registration: matricula, tax_id: cpfBom },
    ]);
    expect(primeira.status).toBe(201);
    const login = primeira.body.results[0].login as string;

    const outroCpf = cpfFicticio(Date.now() + 32452843);
    const segunda = await importar([
      { name: `Ana Completa ${SUFIXO}`, registration: matricula, tax_id: outroCpf },
    ]);
    const linha = segunda.body.results[0] as { status: string };
    expect(linha.status, "nada a completar").toBe("skipped");

    const ficha = await prisma.employeeProfile.findFirstOrThrow({
      where: { organizationId: ORG_ID, user: { login } },
      select: { taxId: true },
    });
    expect(ficha.taxId, "o CPF que já estava continua").toBe(cpfBom);
  });

  it("a prévia conta o que completaria, sem gravar", async () => {
    const matricula = `E${SUFIXO}`.slice(0, 12);
    await importar([{ name: `Previa ${SUFIXO}`, registration: matricula }]);
    const cpf = cpfFicticio(Date.now() + 49979687);

    const previa = await importar(
      [{ name: `Previa ${SUFIXO}`, registration: matricula, tax_id: cpf }],
      true,
    );
    expect(previa.status).toBe(200);
    expect(previa.body.completed).toBe(1);
    expect(previa.body.results[0].filled).toContain("CPF");

    const ficha = await prisma.employeeProfile.findFirstOrThrow({
      where: { organizationId: ORG_ID, registration: matricula },
      select: { taxId: true },
    });
    expect(ficha.taxId, "prévia não grava").toBeNull();
  });
});
