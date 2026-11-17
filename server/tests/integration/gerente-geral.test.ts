import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import type { Express } from "express";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O papel "Gerente geral", na rota: cadastra pessoas, cria funções, age na
 * Ativação sobre quem está abaixo, vê a empresa toda e os dados da folha;
 * não corrige CPF, não desliga, não dá Fiscal nem Gerente geral, e não vê o
 * dado de saúde dos outros. Decisões do Leonardo em 17/11/2026. [GG]
 *
 * Empresa própria, criada e apagada aqui.
 */
const SUFIXO = Date.now().toString(36);
const SENHA = ["gerente", "geral", SUFIXO].join("-");
const as = (t: string) => ({ Authorization: `Bearer ${t}` });

let app: Express;
let orgId = "";
let contaId = "";
let lojaA = "";
let lojaB = "";
let setorA = "";
const usuarios: string[] = [];
const token: Record<string, string> = {};
const id: Record<string, string> = {};
const ficha: Record<string, string> = {};

function cpfFicticio(semente: number): string {
  const base = String(100000000 + (semente % 800000000));
  const d = base.split("").map(Number);
  const dv = (n: number) => {
    const r = (d.slice(0, n).reduce((t, x, i) => t + x * (n + 1 - i), 0) * 10) % 11;
    return r === 10 ? 0 : r;
  };
  d.push(dv(9));
  d.push(dv(10));
  return d.join("");
}

async function pessoa(chave: string, role: Role, loja: string | null, gere: string | null = null) {
  const login = `gg.${chave}.${SUFIXO}`;
  const user = await prisma.user.create({
    data: { login, name: `GG ${chave} ${SUFIXO}`, passwordHash: await bcrypt.hash(SENHA, 4), activatedAt: new Date() },
  });
  usuarios.push(user.id);
  id[chave] = user.id;
  const m = await prisma.membership.create({ data: { userId: user.id, organizationId: orgId, role } });
  await prisma.accountMembership.create({ data: { accountId: contaId, userId: user.id, role: AccountRole.USER } });
  if (loja) {
    ficha[chave] = (
      await prisma.employeeProfile.create({
        data: { organizationId: orgId, userId: user.id, establishmentId: loja, registration: `9${usuarios.length}${SUFIXO}`.slice(0, 12) },
      })
    ).id;
  }
  if (gere) {
    await prisma.managedEstablishment.create({
      data: { organizationId: orgId, membershipId: m.id, establishmentId: gere, createdById: user.id },
    });
  }
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `${chave}: ${JSON.stringify(res.body)}`).toBe(200);
  token[chave] = res.body.token;
}

const importar = (quem: string, people: Record<string, unknown>[], extra: Record<string, unknown> = {}) =>
  request(app).post("/api/pessoas-acessos/importar").set(as(token[quem]!)).send({ people, ...extra });
const nova = (n: number, extra: Record<string, unknown> = {}) => ({
  name: `GG Nova ${n} ${SUFIXO}`,
  tax_id: cpfFicticio(Date.now() + n * 7919),
  registration: `N${n}${SUFIXO}`.slice(0, 12),
  birth_date: "1990-05-10",
  establishment_id: lojaA,
  ...extra,
});

beforeAll(async () => {
  app = createApp();
  orgId = (await prisma.organization.create({ data: { name: `GG ${SUFIXO}` } })).id;
  contaId = (await prisma.account.create({ data: { organizationId: orgId, name: `Conta GG ${SUFIXO}` } })).id;
  lojaA = (await prisma.establishment.create({ data: { organizationId: orgId, name: `Loja A ${SUFIXO}` } })).id;
  lojaB = (await prisma.establishment.create({ data: { organizationId: orgId, name: `Loja B ${SUFIXO}` } })).id;
  setorA = (await prisma.sector.create({ data: { organizationId: orgId, establishmentId: lojaA, name: "Frente" } })).id;
  await pessoa("geral", Role.GERENTE_GERAL, lojaA);
  await pessoa("gerente", Role.GERENTE, lojaA, lojaA);
  await pessoa("rita", Role.RH, null);
  await pessoa("mia", Role.MASTER, null);
  await pessoa("dono", Role.OWNER, null);
  await pessoa("fis", Role.FISCAL, null);
  await pessoa("outro", Role.GERENTE_GERAL, lojaA);
  await pessoa("ana", Role.COLABORADOR, lojaB);
});

afterAll(async () => {
  if (!orgId) return;
  const todos = await prisma.membership.findMany({ where: { organizationId: orgId }, select: { userId: true } });
  const ids = [...new Set([...usuarios, ...todos.map((m) => m.userId)])];
  await prisma.notification.deleteMany({ where: { organizationId: orgId } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.medicalCertificate.deleteMany({ where: { organizationId: orgId } });
  await prisma.occupationalExam.deleteMany({ where: { organizationId: orgId } });
  await prisma.managedEstablishment.deleteMany({ where: { organizationId: orgId } });
  await prisma.employeeProfile.deleteMany({ where: { organizationId: orgId } });
  await prisma.accountMembership.deleteMany({ where: { accountId: contaId } });
  await prisma.membership.deleteMany({ where: { organizationId: orgId } });
  await prisma.activationToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.token.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.jobRoleAlias.deleteMany({ where: { organizationId: orgId } });
  await prisma.jobRole.deleteMany({ where: { organizationId: orgId } });
  await prisma.sector.deleteMany({ where: { organizationId: orgId } });
  await prisma.establishment.deleteMany({ where: { organizationId: orgId } });
  await prisma.account.deleteMany({ where: { id: contaId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
});

describe("cadastrar", () => {
  it("pela planilha e pelo formulário, com papel de Gerente e abaixo", async () => {
    const res = await importar("geral", [nova(1, { org_role: "GERENTE" })]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.results[0].status).toBe("created");
    const pelaTela = await importar("geral", [nova(2)], { origem: "formulario" });
    expect(pelaTela.status, JSON.stringify(pelaTela.body)).toBe(201);
    expect(pelaTela.body.results[0].status).toBe("created");
  });

  it("não dá Gerente geral, RH, Master nem Fiscal", async () => {
    for (const [n, org_role] of [[3, "GERENTE_GERAL"], [4, "RH"], [5, "MASTER"], [6, "FISCAL"]] as const) {
      const res = await importar("geral", [nova(n, { org_role })]);
      expect(res.body.results[0], org_role).toMatchObject({ status: "error", message: "Você não pode dar este papel." });
    }
    expect(await prisma.user.count({ where: { name: { in: [3, 4, 5, 6].map((n) => `GG Nova ${n} ${SUFIXO}`) } } })).toBe(0);
  });

  it("o RH dá Gerente geral pela planilha; o Gerente não cadastra", async () => {
    const res = await importar("rita", [nova(7, { org_role: "GERENTE_GERAL" })]);
    expect(res.body.results[0].status, JSON.stringify(res.body.results[0])).toBe("created");
    const conta = await prisma.user.findUniqueOrThrow({ where: { login: res.body.results[0].login } });
    const vinculo = await prisma.membership.findFirstOrThrow({ where: { organizationId: orgId, userId: conta.id } });
    expect(vinculo.role).toBe(Role.GERENTE_GERAL);
    expect((await importar("gerente", [nova(8)])).status).toBe(403);
  });

  it("cria as funções que faltam na prévia", async () => {
    const res = await request(app)
      .post("/api/pessoas-acessos/importar/estrutura")
      .set(as(token.geral!))
      .send({ escolhas: [{ filial_id: lojaA, cargo: "REPOSITOR GG", acao: "criar", nome: "Repositor GG", setor_id: setorA }] });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    expect(await prisma.jobRole.count({ where: { organizationId: orgId, name: "Repositor GG" } })).toBe(1);
  });
});

describe("a Ativação de contas", () => {
  it("age e vê a empresa toda; o Gerente vê só a unidade que gere", async () => {
    const painel = await request(app).get("/api/pessoas-acessos/ativacao").set(as(token.geral!));
    expect(painel.status, JSON.stringify(painel.body)).toBe(200);
    expect(painel.body.can_act).toBe(true);
    const nomes = (painel.body.people as { userId: string }[]).map((p) => p.userId);
    expect(nomes, "a colaboradora da loja B").toContain(id.ana);
    const doGerente = await request(app).get("/api/pessoas-acessos/ativacao").set(as(token.gerente!));
    expect(doGerente.body.can_act).toBe(false);
    expect((doGerente.body.people as { userId: string }[]).map((p) => p.userId)).not.toContain(id.ana);
  });

  it("redefine a senha e reabre o primeiro acesso de quem está abaixo", async () => {
    const reset = await request(app).post(`/api/pessoas-acessos/${id.gerente}/redefinir-senha`).set(as(token.geral!));
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    expect(typeof reset.body.temporary_password).toBe("string");

    const criada = await importar("geral", [nova(9)]);
    const alvo = await prisma.user.findUniqueOrThrow({ where: { login: criada.body.results[0].login } });
    await prisma.user.update({ where: { id: alvo.id }, data: { firstAccessUntil: new Date(Date.now() - 1000) } });
    const reabrir = await request(app).post(`/api/pessoas-acessos/${alvo.id}/reabrir-primeiro-acesso`).set(as(token.geral!));
    expect(reabrir.status, JSON.stringify(reabrir.body)).toBe(200);
  });

  it("recebe 403 sobre Gerente geral, RH, Master, Dono e Fiscal", async () => {
    for (const quem of ["outro", "rita", "mia", "dono", "fis"]) {
      const reset = await request(app).post(`/api/pessoas-acessos/${id[quem]}/redefinir-senha`).set(as(token.geral!));
      expect(reset.status, `redefinir: ${quem}`).toBe(403);
    }
  });
});

describe("o papel dos outros", () => {
  it("muda para Gerente; não para Gerente geral nem RH", async () => {
    const mudar = (org_role: string) =>
      request(app).patch(`/api/pessoas-acessos/${id.ana}/papel`).set(as(token.geral!)).send({ org_role });
    expect((await mudar("GERENTE_GERAL")).status).toBe(403);
    expect((await mudar("RH")).status).toBe(403);
    const ok = await mudar("GERENTE");
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await mudar("COLABORADOR")).status).toBe(200);
  });
});

describe("a ficha e a folha", () => {
  it("lê e edita os dados da folha de quem é de outra filial", async () => {
    const res = await request(app).get(`/api/employee-profiles/${ficha.ana}/dados-da-folha`).set(as(token.geral!));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.pode_editar).toBe(true);
    const doGerente = await request(app).get(`/api/employee-profiles/${ficha.ana}/dados-da-folha`).set(as(token.gerente!));
    expect(doGerente.status).not.toBe(200);
  });

  it("não corrige o CPF nem registra o desligamento", async () => {
    const cpf = await request(app)
      .patch(`/api/employee-profiles/${ficha.ana}`)
      .set(as(token.geral!))
      .send({ tax_id: cpfFicticio(Date.now() + 31) });
    expect(cpf.status).toBe(403);
    const desligar = await request(app).post(`/api/employee-profiles/${ficha.ana}/desligamento`).set(as(token.geral!)).send({});
    expect(desligar.status).toBe(403);
    expect((await prisma.employeeProfile.findUniqueOrThrow({ where: { id: ficha.ana } })).dismissedAt).toBeNull();
  });
});

describe("o dado de saúde dos outros", () => {
  it("não vê o ASO nem o atestado da colaboradora", async () => {
    const exame = await request(app)
      .post("/api/occupational-exams")
      .set(as(token.rita!))
      .send({ user_id: id.ana, kind: "PERIODIC", performed_at: "2026-09-01", fit: true });
    expect(exame.status, JSON.stringify(exame.body)).toBe(201);
    const exames = await request(app).get("/api/occupational-exams").set(as(token.geral!));
    expect(exames.status).toBe(200);
    expect(JSON.stringify(exames.body)).not.toContain(id.ana!);

    const envio = await request(app)
      .post("/api/medical-certificates")
      .set(as(token.ana!))
      .send({
        start_date: "2026-11-10",
        days: 2,
        cid: "J11",
        reason: "Gripe",
        file_name: "atestado.pdf",
        mime_type: "application/pdf",
        content_base64: Buffer.from("%PDF-1.4 atestado").toString("base64"),
      });
    expect(envio.status, JSON.stringify(envio.body)).toBe(201);
    const atestado = envio.body.certificate.id as string;
    const lista = await request(app).get("/api/medical-certificates").set(as(token.geral!));
    expect(JSON.stringify(lista.body)).not.toContain("J11");
    expect(JSON.stringify(lista.body)).not.toContain("Gripe");
    expect((await request(app).get(`/api/medical-certificates/${atestado}/file`).set(as(token.geral!))).status).toBe(404);
  });
});
