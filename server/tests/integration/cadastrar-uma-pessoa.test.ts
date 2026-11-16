import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Cadastrar uma pessoa pelo formulário de Conta e usuários: a mesma rota da
 * planilha, com `origem: "formulario"`. Pede nascimento e CPF ou matrícula,
 * uma pessoa por vez, e a trilha grava a origem.
 *
 * Usa a organização do `scripts/seed-teste-org.ts`. A filial "Outra" e a
 * função dela são criadas aqui; tudo é apagado no fim.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const FILIAL_DO_SEED = "aaaaaaaa-0001-4000-8000-000000000011";
const JOB_ID = "aaaaaaaa-0001-4000-8000-000000000013";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
const as = (t: string) => ({ Authorization: `Bearer ${t}` });

let app: Express;
const token: Record<string, string> = {};
let outraFilial = "";
let funcaoDaOutra = "";

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

const cadastrar = (quem: string, pessoa: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  request(app)
    .post("/api/pessoas-acessos/importar")
    .set(as(token[quem]!))
    .send({ people: [pessoa], origem: "formulario", ...extra });

const pessoa = (n: number, extra: Record<string, unknown> = {}) => ({
  name: `Pessoa Formulario ${n} ${SUFIXO}`,
  tax_id: cpfFicticio(Date.now() + n * 104729),
  registration: `F${n}${SUFIXO}`.slice(0, 12),
  birth_date: "1990-05-10",
  job_role_id: JOB_ID,
  ...extra,
});

beforeAll(async () => {
  /* A tela de entrada mostra as filiais desta empresa. */
  process.env.LOGIN_ORG_ID = ORG_ID;
  app = createApp();
  for (const quem of ["rh", "sst", "supervisor"]) {
    const res = await request(app).post("/api/auth").send({ login: `teste.${quem}`, password: SENHA });
    expect(res.status, `login de ${quem}`).toBe(200);
    token[quem] = res.body.token;
  }
  outraFilial = (await prisma.establishment.create({ data: { organizationId: ORG_ID, name: `Outra ${SUFIXO}` } })).id;
  const setor = await prisma.sector.create({ data: { organizationId: ORG_ID, establishmentId: outraFilial, name: "Setor" } });
  funcaoDaOutra = (await prisma.jobRole.create({ data: { organizationId: ORG_ID, sectorId: setor.id, name: `Função ${SUFIXO}` } })).id;
});

afterAll(async () => {
  delete process.env.LOGIN_ORG_ID;
  const users = await prisma.user.findMany({ where: { name: { contains: `Formulario` , endsWith: SUFIXO } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const fichas = await prisma.employeeProfile.findMany({ where: { userId: { in: ids } }, select: { id: true } });
  await prisma.auditEvent.deleteMany({
    where: { organizationId: ORG_ID, entityId: { in: [...ids, ...fichas.map((f) => f.id)] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.jobRole.deleteMany({ where: { id: funcaoDaOutra } });
  await prisma.sector.deleteMany({ where: { establishmentId: outraFilial } });
  await prisma.establishment.deleteMany({ where: { id: outraFilial } });
});

describe("o formulário de uma pessoa", () => {
  it("conferir não grava; cadastrar cria a conta aguardando o primeiro acesso, e a trilha diz formulario", async () => {
    const p = pessoa(1);
    const previa = await cadastrar("rh", p, { dry_run: true });
    expect(previa.status).toBe(200);
    expect(previa.body.results[0]).toMatchObject({ status: "created" });
    expect(await prisma.employeeProfile.count({ where: { organizationId: ORG_ID, taxId: p.tax_id } })).toBe(0);

    const res = await cadastrar("rh", p);
    expect(res.status).toBe(201);
    const r = res.body.results[0];
    expect(r).toMatchObject({ status: "created", awaiting_first_access: true });
    const conta = await prisma.user.findUniqueOrThrow({ where: { login: r.login } });
    expect(conta.activatedAt).toBeNull();
    const trilha = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: ORG_ID, action: "employee_profile.create", entityId: conta.id },
    });
    expect((trilha.after as { via: string }).via).toBe("formulario");
  });

  it("de novo com o mesmo CPF: não cria outra pessoa, completa a ficha, e a trilha diz formulario", async () => {
    const p = pessoa(2);
    expect((await cadastrar("rh", p)).status).toBe(201);
    const deNovo = await cadastrar("rh", { ...p, admitted_at: "2024-02-01" });
    expect(deNovo.status).toBe(201);
    expect(deNovo.body.results[0].status).toBe("completed");
    const fichas = await prisma.employeeProfile.findMany({ where: { organizationId: ORG_ID, taxId: p.tax_id } });
    expect(fichas).toHaveLength(1);
    const trilha = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: ORG_ID, action: "employee_profile.update", entityType: "EmployeeProfile", entityId: fichas[0]!.id },
      orderBy: { createdAt: "desc" },
    });
    expect(trilha.after).toMatchObject({ via: "formulario" });
    expect((trilha.after as { filled: string[] }).filled.length).toBeGreaterThan(0);
  });

  it("o campo divergente aceito pela API com origem formulario: a trilha diz formulario", async () => {
    const p = pessoa(13);
    expect((await cadastrar("rh", p)).status).toBe(201);
    const res = await cadastrar("rh", { ...p, birth_date: "1991-06-11", aceitar: ["birth_date"] });
    expect(res.status).toBe(201);
    const ficha = await prisma.employeeProfile.findFirstOrThrow({ where: { organizationId: ORG_ID, taxId: p.tax_id } });
    expect(ficha.birthDate?.toISOString().slice(0, 10)).toBe("1991-06-11");
    const trilha = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: ORG_ID, action: "employee_profile.update", entityType: "EmployeeProfile", entityId: ficha.id },
      orderBy: { createdAt: "desc" },
    });
    expect(trilha.after).toMatchObject({ via: "formulario", confirmed: ["birth_date"] });
  });

  it("sem nascimento, sem CPF ou sem matrícula: 400, com ou sem conferir, e nada gravado", async () => {
    for (const dry_run of [true, false]) {
      const semNascimento = await cadastrar("rh", pessoa(3, { birth_date: "" }), { dry_run });
      expect(semNascimento.status).toBe(400);
      expect(semNascimento.body.message).toBe("Informe a data de nascimento: é com ela que a pessoa faz o primeiro acesso.");
      const semCpf = await cadastrar("rh", pessoa(4, { tax_id: "  " }), { dry_run });
      expect(semCpf.status).toBe(400);
      expect(semCpf.body.message).toBe("Informe o CPF: o primeiro acesso pede matrícula, CPF e data de nascimento.");
      const semMatricula = await cadastrar("rh", pessoa(5, { registration: undefined }), { dry_run });
      expect(semMatricula.status).toBe(400);
      expect(semMatricula.body.message).toBe("Informe a matrícula: o primeiro acesso pede matrícula, CPF e data de nascimento.");
    }
    expect(await prisma.user.count({ where: { name: { in: [3, 4, 5].map((n) => `Pessoa Formulario ${n} ${SUFIXO}`) } } })).toBe(0);
  });

  it("com nascimento, CPF e matrícula, a pessoa cadastrada faz o primeiro acesso", async () => {
    const p = pessoa(6);
    const res = await cadastrar("rh", p);
    expect(res.status).toBe(201);
    const ficha = await prisma.employeeProfile.findFirstOrThrow({
      where: { organizationId: ORG_ID, taxId: p.tax_id },
      select: { establishmentId: true },
    });
    const acesso = await request(app).post("/api/auth/primeiro-acesso").send({
      matricula: p.registration,
      cpf: p.tax_id,
      nascimento: p.birth_date,
      establishment_id: ficha.establishmentId,
    });
    expect(acesso.status, JSON.stringify(acesso.body)).toBe(200);
    expect(typeof acesso.body.token).toBe("string");
  });

  it("pela planilha, sem nascimento e sem CPF, segue como antes, e a trilha diz import", async () => {
    const semNada = { name: `Pessoa Formulario 7 ${SUFIXO}`, job_role_id: JOB_ID };
    const res = await request(app).post("/api/pessoas-acessos/importar").set(as(token.rh!)).send({ people: [semNada] });
    expect(res.status).toBe(201);
    expect(res.body.results[0].status).toBe("created");
    const conta = await prisma.user.findUniqueOrThrow({ where: { login: res.body.results[0].login } });
    const trilha = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: ORG_ID, action: "employee_profile.create", entityId: conta.id },
    });
    expect((trilha.after as { via: string }).via).toBe("import");
  });

  it("origem inválida: 400; o formulário com duas pessoas: 400; nada gravado", async () => {
    const invalida = await request(app)
      .post("/api/pessoas-acessos/importar")
      .set(as(token.rh!))
      .send({ people: [pessoa(8)], origem: "outra" });
    expect(invalida.status).toBe(400);
    expect(invalida.body.message).toBe('A origem é "planilha" ou "formulario".');
    const duas = await request(app)
      .post("/api/pessoas-acessos/importar")
      .set(as(token.rh!))
      .send({ people: [pessoa(9), pessoa(10)], origem: "formulario" });
    expect(duas.status).toBe(400);
    expect(duas.body.message).toBe("O formulário cadastra uma pessoa por vez.");
    expect(await prisma.user.count({ where: { name: { in: [8, 9, 10].map((n) => `Pessoa Formulario ${n} ${SUFIXO}`) } } })).toBe(0);
  });

  it("o SST e o supervisor, que não editam Conta, recebem 403; o RH não dá papel de Master", async () => {
    expect((await cadastrar("sst", pessoa(11))).status).toBe(403);
    expect((await cadastrar("supervisor", pessoa(11))).status).toBe(403);
    const master = await cadastrar("rh", pessoa(11, { org_role: "MASTER" }));
    expect(master.body.results[0]).toMatchObject({ status: "error", message: "Você não pode dar este papel." });
  });

  it("a função de outra filial é recusada", async () => {
    const res = await cadastrar("rh", pessoa(12, { job_role_id: funcaoDaOutra, establishment_id: FILIAL_DO_SEED }));
    expect(res.body.results[0]).toMatchObject({ status: "error", message: "A função escolhida é de outra filial." });
    expect(await prisma.user.count({ where: { name: `Pessoa Formulario 12 ${SUFIXO}` } })).toBe(0);
  });
});
