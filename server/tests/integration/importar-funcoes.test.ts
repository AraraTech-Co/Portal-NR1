import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { lerLinhas, type FuncaoDaEmpresa } from "../../../client/src/lib/planilha";

/**
 * Cadastrar setores e funções por planilha (desenho de 13/11).
 *
 * Empresa própria do teste:
 * - a Loja (código 0682) já tem o setor "Loja", com a função CAIXA
 *   (CBO 4211-25), e uma FAXINEIRA arquivada;
 * - a AG (código 0683, CNPJ conhecido) não tem nada;
 * - Sara é SST, Rita é RH (só lê a Operação) e Otto é ADM loja só da Loja.
 *
 * Apagada no fim.
 */
const SUFIXO = Date.now().toString(36);
const SENHA = ["importar", "funcoes", "lote"].join("-");
const CNPJ_AG = "30589468000124";
const as = (t: string) => ({ Authorization: `Bearer ${t}` });

let app: Express;
let orgId = "";
let contaId = "";
let loja = { id: "", name: "" };
let ag = { id: "", name: "" };
let caixa = "";
const usuarios: string[] = [];
const token: Record<string, string> = {};

async function pessoa(nome: string, role: Role, gere?: string) {
  const login = `impf.${nome.toLowerCase()}.${SUFIXO}`;
  const user = await prisma.user.create({ data: { login, name: `${nome} ${SUFIXO}`, passwordHash: await bcrypt.hash(SENHA, 4) } });
  usuarios.push(user.id);
  const m = await prisma.membership.create({ data: { userId: user.id, organizationId: orgId, role } });
  await prisma.accountMembership.create({ data: { accountId: contaId, userId: user.id, role: AccountRole.USER } });
  if (gere) {
    await prisma.managedEstablishment.create({
      data: { organizationId: orgId, membershipId: m.id, establishmentId: gere, createdById: user.id },
    });
  }
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  token[nome] = res.body.token;
}

type Linha = { filial: string; setor: string; funcao: string; cbo_2002?: string; cbo_94?: string };
const importar = (quem: string, linhas: Linha[], dry_run: boolean) =>
  request(app)
    .post("/api/job-roles/importar")
    .set(as(token[quem]!))
    .send({ dry_run, rows: linhas.map((l, i) => ({ line: i + 2, ...l })) });

const funcoesDa = (estId: string) =>
  prisma.jobRole.findMany({
    where: { organizationId: orgId, archivedAt: null, sector: { establishmentId: estId } },
    select: { id: true, name: true, cbo2002: true, sector: { select: { name: true } } },
    orderBy: { name: "asc" },
  });

beforeAll(async () => {
  app = createApp();
  orgId = (await prisma.organization.create({ data: { name: `IMPF ${SUFIXO}` } })).id;
  contaId = (await prisma.account.create({ data: { organizationId: orgId, name: `Conta IMPF ${SUFIXO}` } })).id;
  loja = await prisma.establishment.create({
    data: { organizationId: orgId, name: `Loja ${SUFIXO}`, payrollCode: "0682" },
    select: { id: true, name: true },
  });
  ag = await prisma.establishment.create({
    data: { organizationId: orgId, name: `AG ${SUFIXO}`, payrollCode: "0683", taxId: CNPJ_AG },
    select: { id: true, name: true },
  });
  const setorLoja = await prisma.sector.create({ data: { organizationId: orgId, establishmentId: loja.id, name: "Loja" } });
  caixa = (
    await prisma.jobRole.create({ data: { organizationId: orgId, sectorId: setorLoja.id, name: "CAIXA", cbo2002: "4211-25" } })
  ).id;
  await prisma.jobRole.create({
    data: { organizationId: orgId, sectorId: setorLoja.id, name: "FAXINEIRA", archivedAt: new Date() },
  });
  await pessoa("Sara", Role.SST);
  await pessoa("Rita", Role.RH);
  await pessoa("Otto", Role.ADM_LOJA, loja.id);
});

afterAll(async () => {
  if (!orgId) return;
  await prisma.auditEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.managedEstablishment.deleteMany({ where: { organizationId: orgId } });
  await prisma.accountMembership.deleteMany({ where: { accountId: contaId } });
  await prisma.membership.deleteMany({ where: { organizationId: orgId } });
  await prisma.token.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.jobRole.deleteMany({ where: { organizationId: orgId } });
  await prisma.sector.deleteMany({ where: { organizationId: orgId } });
  await prisma.establishment.deleteMany({ where: { organizationId: orgId } });
  await prisma.account.deleteMany({ where: { id: contaId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
});

const PLANILHA: Linha[] = [
  { filial: "0682", setor: "Loja", funcao: "CAIXA" },
  { filial: "682", setor: "loja", funcao: "Caixa ", cbo_2002: "4211-30" },
  { filial: "0682", setor: "Estoque", funcao: "ESTOQUISTA", cbo_2002: "4141-25" },
  { filial: "0682", setor: "ESTOQUE", funcao: "CONFERENTE" },
  { filial: "0682", setor: "Limpeza", funcao: "FAXINEIRA" },
  { filial: "0682", setor: "Estoque", funcao: "estoquista" },
  { filial: CNPJ_AG, setor: "Administrativo", funcao: "AUXILIAR ADMINISTRATIVO", cbo_2002: "4110-05", cbo_94: "3-91.10" },
  { filial: "9999", setor: "Loja", funcao: "X" },
  { filial: "0683", setor: "Administrativo", funcao: "LIDER", cbo_2002: "abc" },
  { filial: "0683", setor: "", funcao: "SEM SETOR" },
];

describe("quem importa", () => {
  it("o RH, que só lê a Operação, recebe 403", async () => {
    expect((await importar("Rita", PLANILHA, true)).status).toBe(403);
  });
});

describe("a prévia", () => {
  it("diz linha a linha o que aconteceria, e não grava nada", async () => {
    const antes = await prisma.jobRole.count({ where: { organizationId: orgId } });
    const res = await importar("Sara", PLANILHA, true);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.results.map((r: { situacao: string }) => r.situacao)).toEqual([
      "ja_existe",
      "ja_existe",
      "cria_setor_e_funcao",
      "cria_funcao",
      "cria_setor_e_funcao",
      "repetida",
      "cria_setor_e_funcao",
      "erro",
      "erro",
      "erro",
    ]);
    const msg = (i: number) => res.body.results[i].message as string;
    expect(msg(1)).toBe(
      "Já existe na filial, com CBO 2002 4211-25; a planilha diz 4211-30. Nada muda: corrija pela edição da função, se for o caso.",
    );
    expect(msg(5)).toBe("Repetida na planilha (já está na linha 4).");
    expect(msg(7)).toContain('Filial "9999" não existe nesta empresa');
    expect(msg(8)).toBe("CBO 2002 inválido: use os números do código, como 5211-25.");
    expect(msg(9)).toBe("Informe a filial, o setor e a função.");
    expect(res.body.results[6].filial).toBe(ag.name);
    expect([res.body.criariam, res.body.ja_existem, res.body.repetidas, res.body.erros]).toEqual([4, 2, 1, 3]);
    expect(await prisma.jobRole.count({ where: { organizationId: orgId } })).toBe(antes);
  });
});

describe("a gravação", () => {
  it("cria os setores e as funções que faltam, com o CBO, e não mexe na que já existe", async () => {
    const res = await importar("Sara", PLANILHA, false);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect([res.body.setores_criados, res.body.funcoes_criadas]).toEqual([3, 4]);

    expect((await funcoesDa(loja.id)).map((f) => [f.sector.name, f.name, f.cbo2002])).toEqual([
      ["Loja", "CAIXA", "4211-25"],
      ["Estoque", "CONFERENTE", null],
      ["Estoque", "ESTOQUISTA", "4141-25"],
      ["Limpeza", "FAXINEIRA", null],
    ]);
    const daAg = await prisma.jobRole.findFirstOrThrow({
      where: { organizationId: orgId, sector: { establishmentId: ag.id } },
      select: { name: true, cbo2002: true, cbo94: true, sector: { select: { name: true } } },
    });
    expect(daAg).toEqual({ name: "AUXILIAR ADMINISTRATIVO", cbo2002: "4110-05", cbo94: "3-91.10", sector: { name: "Administrativo" } });
    /* O "Estoque" foi criado uma vez só, para as duas funções. */
    expect(await prisma.sector.count({ where: { organizationId: orgId, establishmentId: loja.id, name: { in: ["Estoque", "ESTOQUE"] } } })).toBe(1);
  });

  it("a trilha é a do cadastro à mão, mais a da importação", async () => {
    const acoes = await prisma.auditEvent.groupBy({
      by: ["action"],
      where: { organizationId: orgId, action: { in: ["sector.create", "job_role.create", "job_roles.import"] } },
      _count: true,
    });
    expect(Object.fromEntries(acoes.map((a) => [a.action, a._count]))).toEqual({
      "sector.create": 3,
      "job_role.create": 4,
      "job_roles.import": 1,
    });
  });

  it("enviar de novo não cria nada: tudo já existe", async () => {
    const res = await importar("Sara", PLANILHA.slice(0, 7), false);
    expect(res.body.funcoes_criadas).toBe(0);
    expect(res.body.results.every((r: { situacao: string }) => r.situacao === "ja_existe" || r.situacao === "repetida")).toBe(true);
  });

  it("a planilha de pessoas casa as funções criadas, em qualquer grafia", async () => {
    const rows = await prisma.jobRole.findMany({
      where: { organizationId: orgId, archivedAt: null },
      select: { id: true, name: true, sector: { select: { establishment: { select: { id: true, name: true } } } } },
    });
    const funcoes = rows.map((f) => ({ id: f.id, name: f.name, establishment: f.sector.establishment })) as FuncaoDaEmpresa[];
    const lido = lerLinhas(
      `nome;funcao;filial\nAna;Estoquista;${loja.name}\nBia;auxiliar administrativo;${ag.name}`,
      funcoes,
      [],
      { papeis: {}, vinculos: {} },
      [
        { id: loja.id, name: loja.name, taxId: null, payrollCode: "0682" },
        { id: ag.id, name: ag.name, taxId: CNPJ_AG, payrollCode: "0683" },
      ],
    );
    expect(lido.problems).toEqual([]);
    const ids = new Map(rows.map((f) => [f.name, f.id]));
    expect(lido.rows.map((r) => r.job_role_id)).toEqual([ids.get("ESTOQUISTA"), ids.get("AUXILIAR ADMINISTRATIVO")]);
  });
});

describe("o ADM loja", () => {
  it("importa só nas filiais que gere", async () => {
    const res = await importar(
      "Otto",
      [
        { filial: "0683", setor: "Administrativo", funcao: "DO OTTO NA AG" },
        { filial: "0682", setor: "Loja", funcao: "DO OTTO NA LOJA" },
      ],
      false,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.results.map((r: { situacao: string }) => r.situacao)).toEqual(["erro", "cria_funcao"]);
    expect(res.body.results[0].message).toBe(`A filial ${ag.name} está fora das que você gere.`);
  });
});

describe("dois envios ao mesmo tempo", () => {
  it("terminam com um setor e uma função só", async () => {
    const linha = [{ filial: "0683", setor: "Paralelo", funcao: "AO MESMO TEMPO" }];
    const [a, b] = await Promise.all([importar("Sara", linha, false), importar("Sara", linha, false)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.funcoes_criadas + b.body.funcoes_criadas).toBe(1);
    expect(await prisma.jobRole.count({ where: { organizationId: orgId, name: "AO MESMO TEMPO" } })).toBe(1);
    expect(await prisma.sector.count({ where: { organizationId: orgId, name: "Paralelo" } })).toBe(1);
  });
});
