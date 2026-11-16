import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Criar as funções que faltam a partir da prévia da planilha da folha
 * (Correção 6, C6-3 e C6-4).
 *
 * Empresa própria do teste:
 * - a Loja tem o setor "Frente", com a função Caixa (4211-25), e uma função
 *   arquivada "Antiga";
 * - a AG não tem nada;
 * - Mia é Master (Operação e Conta), Rita é RH (Conta, Operação só leitura)
 *   e Sara é SST (Operação, sem Conta).
 *
 * Apagada no fim.
 */
const SUFIXO = Date.now().toString(36);
const SENHA = ["estrutura", "da", "folha"].join("-");
const as = (t: string) => ({ Authorization: `Bearer ${t}` });

let app: Express;
let orgId = "";
let contaId = "";
let loja = "";
let ag = "";
let frente = "";
let caixa = "";
let antiga = "";
const usuarios: string[] = [];
const token: Record<string, string> = {};

async function pessoa(nome: string, role: Role) {
  const login = `estr.${nome.toLowerCase()}.${SUFIXO}`;
  const user = await prisma.user.create({ data: { login, name: `${nome} ${SUFIXO}`, passwordHash: await bcrypt.hash(SENHA, 4) } });
  usuarios.push(user.id);
  await prisma.membership.create({ data: { userId: user.id, organizationId: orgId, role } });
  await prisma.accountMembership.create({ data: { accountId: contaId, userId: user.id, role: AccountRole.USER } });
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  token[nome] = res.body.token;
}

type Escolha = Record<string, unknown>;
const criar = (quem: string, escolhas: Escolha[]) =>
  request(app).post("/api/pessoas-acessos/importar/estrutura").set(as(token[quem]!)).send({ escolhas });

const funcoesAtivas = () =>
  prisma.jobRole.findMany({
    where: { organizationId: orgId, archivedAt: null },
    select: { id: true, name: true, cbo2002: true, description: true, sector: { select: { name: true, establishmentId: true } } },
    orderBy: { name: "asc" },
  });
const contagem = async () => ({
  funcoes: await prisma.jobRole.count({ where: { organizationId: orgId } }),
  setores: await prisma.sector.count({ where: { organizationId: orgId } }),
  apelidos: await prisma.jobRoleAlias.count({ where: { organizationId: orgId } }),
});

beforeAll(async () => {
  app = createApp();
  orgId = (await prisma.organization.create({ data: { name: `ESTR ${SUFIXO}` } })).id;
  contaId = (await prisma.account.create({ data: { organizationId: orgId, name: `Conta ESTR ${SUFIXO}` } })).id;
  loja = (await prisma.establishment.create({ data: { organizationId: orgId, name: `Loja ${SUFIXO}` } })).id;
  ag = (await prisma.establishment.create({ data: { organizationId: orgId, name: `AG ${SUFIXO}` } })).id;
  frente = (await prisma.sector.create({ data: { organizationId: orgId, establishmentId: loja, name: "Frente" } })).id;
  caixa = (await prisma.jobRole.create({ data: { organizationId: orgId, sectorId: frente, name: "Caixa", cbo2002: "4211-25" } })).id;
  antiga = (
    await prisma.jobRole.create({ data: { organizationId: orgId, sectorId: frente, name: "Antiga", archivedAt: new Date() } })
  ).id;
  await pessoa("Mia", Role.MASTER);
  await pessoa("Rita", Role.RH);
  await pessoa("Sara", Role.SST);
});

afterAll(async () => {
  if (!orgId) return;
  await prisma.auditEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.jobRoleAlias.deleteMany({ where: { organizationId: orgId } });
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

describe("quem cria", () => {
  it("o RH (sem Operação) e o SST (sem Conta) recebem 403", async () => {
    const escolha = { filial_id: loja, cargo: "ESTOQUISTA", acao: "criar", nome: "Estoquista", novo_setor: "Estoque" };
    expect((await criar("Rita", [escolha])).status).toBe(403);
    expect((await criar("Sara", [escolha])).status).toBe(403);
  });
});

describe("criar e juntar", () => {
  it("cria Repositor num setor novo, nas duas filiais, com o CBO e a descrição da origem", async () => {
    const res = await criar("Mia", [
      { filial_id: loja, cargo: "REPOSITORA", acao: "criar", nome: "Repositor", novo_setor: "Reposição", cbo_2002: "5211-25" },
      { filial_id: ag, cargo: "REPOSITORA", acao: "criar", nome: "Repositor", novo_setor: "Reposição", cbo_2002: "5211-25" },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect([res.body.setores_criados, res.body.funcoes_criadas]).toEqual([2, 2]);
    const reps = (await funcoesAtivas()).filter((f) => f.name === "Repositor");
    expect(reps.map((f) => f.sector.establishmentId).sort()).toEqual([loja, ag].sort());
    for (const f of reps) {
      expect(f.sector.name).toBe("Reposição");
      expect(f.cbo2002).toBe("5211-25");
      expect(f.description).toMatch(/^Criada pela planilha da folha em \d{2}\/\d{2}\/\d{4}\.$/);
    }
    const trilha = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, action: { in: ["sector.create", "job_role.create"] } },
      select: { after: true },
    });
    expect(trilha).toHaveLength(4);
    expect(trilha.every((t) => (t.after as { via?: string }).via === "planilha da folha")).toBe(true);
  });

  it("criar de novo, com as mesmas escolhas, não duplica nada", async () => {
    const antes = await contagem();
    const res = await criar("Mia", [
      { filial_id: loja, cargo: "REPOSITOR", acao: "criar", nome: "Repositor", novo_setor: "reposicao", cbo_2002: "5211-25" },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect([res.body.funcoes_criadas, res.body.funcoes_reaproveitadas]).toEqual([0, 1]);
    expect(await contagem()).toEqual(antes);
  });

  it("juntar FAXINEIRA com AUXILIAR DE LIMPEZA (novo) dá uma função só e o apelido do cargo", async () => {
    const res = await criar("Mia", [
      { filial_id: loja, cargo: "FAXINEIRA", acao: "juntar", juntar_cargo: "AUXILIAR DE LIMPEZA" },
      { filial_id: loja, cargo: "AUXILIAR DE LIMPEZA", acao: "criar", nome: "Auxiliar de Limpeza", novo_setor: "Limpeza" },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const aux = (await funcoesAtivas()).filter((f) => f.name === "Auxiliar de Limpeza");
    expect(aux).toHaveLength(1);
    const apelido = await prisma.jobRoleAlias.findFirstOrThrow({ where: { organizationId: orgId, chave: "faxineiro" } });
    expect([apelido.jobRoleId, apelido.establishmentId]).toEqual([aux[0]!.id, loja]);
  });

  it("o setor novo com o nome de um setor que já existe na filial é reaproveitado", async () => {
    const antes = await prisma.sector.count({ where: { organizationId: orgId, establishmentId: loja } });
    const res = await criar("Mia", [
      { filial_id: loja, cargo: "OPERADORA DE LOJA", acao: "criar", nome: "Operador de Loja", novo_setor: "frente" },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.setores_criados).toBe(0);
    expect(await prisma.sector.count({ where: { organizationId: orgId, establishmentId: loja } })).toBe(antes);
    const op = (await funcoesAtivas()).find((f) => f.name === "Operador de Loja")!;
    expect(op.sector.name).toBe("Frente");
  });

  it("o nome trocado no criar vira apelido do cargo", async () => {
    const res = await criar("Mia", [
      { filial_id: ag, cargo: "DIRETOR ADMINISTRACAO", acao: "criar", nome: "Diretor Administrativo", novo_setor: "Diretoria" },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const dir = (await funcoesAtivas()).find((f) => f.name === "Diretor Administrativo")!;
    const apelido = await prisma.jobRoleAlias.findFirstOrThrow({ where: { establishmentId: ag, chave: "diretor administracao" } });
    expect(apelido.jobRoleId).toBe(dir.id);
  });

  it("juntar COM OP CAIXA com Caixa: o apelido nasce; de novo, nada muda; com outra função ativa, 409", async () => {
    const primeiro = await criar("Mia", [{ filial_id: loja, cargo: "COM OP CAIXA", acao: "juntar", juntar_funcao_id: caixa }]);
    expect(primeiro.status, JSON.stringify(primeiro.body)).toBe(201);
    expect(primeiro.body.apelidos).toBe(1);
    const segundo = await criar("Mia", [{ filial_id: loja, cargo: "COM OP CAIXA", acao: "juntar", juntar_funcao_id: caixa }]);
    expect([segundo.status, segundo.body.apelidos]).toEqual([201, 0]);
    const rep = (await funcoesAtivas()).find((f) => f.name === "Repositor" && f.sector.establishmentId === loja)!;
    const outro = await criar("Mia", [{ filial_id: loja, cargo: "COM OP CAIXA", acao: "juntar", juntar_funcao_id: rep.id }]);
    expect(outro.status).toBe(409);
    expect(outro.body.message).toContain('já está juntado com a função "Caixa"');
  });

  it("apelido que apontava para função arquivada é reapontado, sem bater na unicidade", async () => {
    await prisma.jobRoleAlias.create({
      data: { organizationId: orgId, establishmentId: loja, chave: "op estoque", grafia: "Op Estoque", jobRoleId: antiga, createdById: usuarios[0]! },
    });
    const res = await criar("Mia", [{ filial_id: loja, cargo: "OP ESTOQUE", acao: "juntar", juntar_funcao_id: caixa }]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const apelidos = await prisma.jobRoleAlias.findMany({ where: { establishmentId: loja, chave: "op estoque" } });
    expect(apelidos.map((a) => [a.jobRoleId, a.grafia])).toEqual([[caixa, "OP ESTOQUE"]]);
  });

  it("juntar um cargo que já casa com outra função da filial: 409", async () => {
    const rep = (await funcoesAtivas()).find((f) => f.name === "Repositor" && f.sector.establishmentId === loja)!;
    const res = await criar("Mia", [{ filial_id: loja, cargo: "CAIXA", acao: "juntar", juntar_funcao_id: rep.id }]);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('já casa com a função "Caixa"');
  });
});

describe("tudo ou nada", () => {
  it("um erro no meio desfaz tudo: nome vazio, setor de outra filial, função de outra filial, CBO inválido", async () => {
    const antes = await contagem();
    const repDaAg = (await funcoesAtivas()).find((f) => f.name === "Repositor" && f.sector.establishmentId === ag)!;
    for (const ruim of [
      { filial_id: loja, cargo: "PEDREIRO", acao: "criar", nome: "", novo_setor: "Obras" },
      { filial_id: ag, cargo: "PEDREIRO", acao: "criar", nome: "Pedreiro", setor_id: frente },
      { filial_id: loja, cargo: "SERVENTE", acao: "juntar", juntar_funcao_id: repDaAg.id },
      { filial_id: loja, cargo: "PEDREIRO", acao: "criar", nome: "Pedreiro", novo_setor: "Obras", cbo_2002: "abc" },
    ]) {
      const res = await criar("Mia", [
        { filial_id: loja, cargo: "ESTOQUISTA", acao: "criar", nome: "Estoquista", novo_setor: "Estoque" },
        ruim,
      ]);
      expect(res.status, JSON.stringify(ruim)).toBe(400);
      expect(res.body.message, JSON.stringify(ruim)).toMatch(/^Escolha 2: .* Nada foi criado\.$/);
    }
    expect(await contagem()).toEqual(antes);
  });

  it("mais de 200 escolhas: 400", async () => {
    const muitas = Array.from({ length: 201 }, (_, i) => ({ filial_id: loja, cargo: `CARGO ${i}`, acao: "criar", nome: `Cargo ${i}`, setor_id: frente }));
    expect((await criar("Mia", muitas)).status).toBe(400);
  });
});

describe("dois cliques ao mesmo tempo", () => {
  it("terminam com um setor e uma função de cada", async () => {
    /*
      Muitas escolhas por envio alongam a transação, e os dois envios se
      sobrepõem de verdade: com uma só, o primeiro terminava antes de o
      segundo passar pelas portas de permissão, e a falta da trava não
      aparecia.
    */
    const escolhas = Array.from({ length: 60 }, (_, i) => ({
      filial_id: ag,
      cargo: `PARALELO ${i}`,
      acao: "criar",
      nome: `Paralelo ${i}`,
      novo_setor: "Manutenção",
    }));
    const [a, b] = await Promise.all([criar("Mia", escolhas), criar("Mia", escolhas)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(await prisma.jobRole.count({ where: { organizationId: orgId, name: { startsWith: "Paralelo " } } })).toBe(60);
    expect(await prisma.sector.count({ where: { organizationId: orgId, name: "Manutenção" } })).toBe(1);
  });
});

describe("o apelido na lista de funções e a remoção", () => {
  it("GET /api/job-roles traz os apelidos; o SST não remove; o Master remove", async () => {
    const lista = await request(app).get("/api/job-roles").set(as(token.Mia!));
    const doCaixa = (lista.body.job_roles as { id: string; aliases: { id: string; chave: string; grafia: string }[] }[]).find(
      (f) => f.id === caixa,
    )!;
    expect(doCaixa.aliases.map((a) => [a.chave, a.grafia])).toEqual([
      ["com op caixo", "COM OP CAIXA"],
      ["op estoque", "OP ESTOQUE"],
    ]);
    const alvo = doCaixa.aliases[0]!;
    expect((await request(app).delete(`/api/job-roles/${caixa}/apelidos/${alvo.id}`).set(as(token.Sara!))).status).toBe(403);
    expect((await request(app).delete(`/api/job-roles/${caixa}/apelidos/${alvo.id}`).set(as(token.Mia!))).status).toBe(204);
    expect(await prisma.jobRoleAlias.count({ where: { id: alvo.id } })).toBe(0);
  });
});
