import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { ContractorRelation } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Cadastrar várias pessoas de uma vez [S1-A] e marcar quem não é empregado,
 * com a empresa contratada de onde vem [S1-G].
 *
 * Usa a organização do `scripts/seed-teste-org.ts`. Apaga no fim só o que
 * criou aqui.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const JOB_ID = "aaaaaaaa-0001-4000-8000-000000000013";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: { token: string };
let supervisor: { token: string };
let contratadaId: string;

const entrar = (login: string, password = SENHA) =>
  request(app).post("/api/auth").send({ login, password });

/**
 * CPF válido e inédito a cada execução: os CPFs fixos conhecidos já estão no
 * seed, e o teste passaria a depender de qual arquivo rodou antes.
 */
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

const CPFS = [0, 1, 2, 3].map((i) => cpfFicticio(Date.now() + i * 7919));

const importar = (
  token: string,
  people: Record<string, unknown>[],
  dryRun = false,
) =>
  request(app)
    .post("/api/pessoas-acessos/importar")
    .set(as(token))
    .send({ people, dry_run: dryRun });

beforeAll(async () => {
  app = createApp();
  rh = (await entrar("teste.rh")).body;
  supervisor = (await entrar("teste.supervisor")).body;
  const contratada = await prisma.contractor.create({
    data: {
      organizationId: ORG_ID,
      name: `Limpeza Contratada ${SUFIXO}`,
      relation: ContractorRelation.WE_HIRE,
    },
  });
  contratadaId = contratada.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${SUFIXO}.local` } } });
  await prisma.user.deleteMany({ where: { name: { contains: `Importada ${SUFIXO}` } } });
  await prisma.contractor.deleteMany({ where: { id: contratadaId } });
});

describe("cadastrar várias pessoas de uma vez [S1-A]", () => {
  it("a prévia confere sem gravar; o cadastro cria o login e a senha de primeiro acesso", async () => {
    const linha = {
      name: `Ana Importada ${SUFIXO}`,
      registration: `IMP-A-${SUFIXO}`.slice(0, 20),
      email: `ana@${SUFIXO}.local`,
      job_role_id: JOB_ID,
      admitted_at: "2025-06-02",
    };

    const previa = await importar(rh.token, [linha], true);
    expect(previa.status).toBe(200);
    expect(previa.body.dry_run).toBe(true);
    expect(previa.body.created).toBe(1);
    expect(previa.body.results[0].login).toBeTruthy();
    // Nada gravado: o e-mail ainda não existe.
    expect(await prisma.user.findFirst({ where: { email: linha.email } })).toBeNull();

    const res = await importar(rh.token, [linha]);
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(1);
    const criada = res.body.results[0];
    expect(criada.status).toBe("created");
    expect(criada.login).toBeTruthy();
    expect(criada.temporary_password).toHaveLength(12);

    // A pessoa entra com a senha e o portal obriga a trocar.
    const login = await entrar(criada.login, criada.temporary_password);
    expect(login.status).toBe(200);
    expect(login.body.user.must_change_password).toBe(true);

    // E chegou com função, matrícula e admissão.
    const perfil = await prisma.employeeProfile.findFirst({
      where: { organizationId: ORG_ID, registration: linha.registration },
      select: { jobRoleId: true, admittedAt: true, bond: true },
    });
    expect(perfil?.jobRoleId).toBe(JOB_ID);
    expect(perfil?.admittedAt?.toISOString().slice(0, 10)).toBe("2025-06-02");
    expect(perfil?.bond).toBe("EMPLOYEE");
  });

  it("uma linha ruim não derruba a leva: o resto entra e cada problema volta com o motivo", async () => {
    // Quem "já existe" é criado aqui mesmo: depender do CPF do seed deixa o
    // teste refém de outro arquivo que edita a ficha do colaborador.
    const jaExiste = await importar(rh.token, [
      { name: `Veterana Importada ${SUFIXO}`, tax_id: CPFS[0] },
    ]);
    expect(jaExiste.body.created).toBe(1);

    const res = await importar(rh.token, [
      { name: `Boa Importada ${SUFIXO}`, email: `boa@${SUFIXO}.local` },
      { name: `CPF torto Importada ${SUFIXO}`, tax_id: "11111111111" },
      { name: "", email: `sem.nome@${SUFIXO}.local` },
      { name: `Função torta Importada ${SUFIXO}`, job_role_id: "nao-existe" },
      { name: `Repetida Importada ${SUFIXO}`, tax_id: CPFS[0] },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(1);
    expect(res.body.errors).toBe(3);
    expect(res.body.skipped).toBe(1);

    const r = res.body.results as { line: number; status: string; message?: string }[];
    expect(r[1]!.message).toMatch(/CPF/i);
    expect(r[2]!.message).toMatch(/nome/i);
    expect(r[3]!.message).toMatch(/[Ff]unção/);
    expect(r[4]!.status).toBe("skipped");
    expect(r[4]!.message).toMatch(/[Jj]á cadastrado/);
  });

  it("repetição dentro da própria planilha é apontada", async () => {
    const res = await importar(rh.token, [
      { name: `Gemea Um Importada ${SUFIXO}`, tax_id: CPFS[2] },
      { name: `Gemea Dois Importada ${SUFIXO}`, tax_id: CPFS[2] },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(1);
    expect((res.body.results as { message?: string }[])[1]!.message).toMatch(
      /repetido na planilha/i,
    );
  });

  it("ninguém importa gente com papel acima do seu, e quem não cuida de Conta não importa", async () => {
    const alto = await importar(rh.token, [
      { name: `Chefe Importada ${SUFIXO}`, org_role: "MASTER" },
    ]);
    expect(alto.status).toBe(201);
    expect(alto.body.created).toBe(0);
    expect((alto.body.results as { message?: string }[])[0]!.message).toMatch(/papel/i);

    const semPermissao = await importar(supervisor.token, [
      { name: `Qualquer Importada ${SUFIXO}` },
    ]);
    expect(semPermissao.status).toBe(403);
  });

  it("planilha gigante é recusada inteira, com o número na mensagem", async () => {
    const muitas = Array.from({ length: 201 }, (_, i) => ({
      name: `Fila ${i} Importada ${SUFIXO}`,
    }));
    const res = await importar(rh.token, muitas);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/201/);
    expect(res.body.message).toMatch(/200/);
  });
});

describe("quem não é empregado fica marcado [S1-G]", () => {
  it("importa terceirizado ligado à empresa contratada", async () => {
    const res = await importar(rh.token, [
      {
        name: `Terceiro Importada ${SUFIXO}`,
        email: `terceiro@${SUFIXO}.local`,
        bond: "CONTRACTOR",
        contractor_id: contratadaId,
        job_role_id: JOB_ID,
      },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(1);

    const user = await prisma.user.findFirst({
      where: { email: `terceiro@${SUFIXO}.local` },
      select: { id: true },
    });
    const perfil = await prisma.employeeProfile.findFirst({
      where: { organizationId: ORG_ID, userId: user!.id },
      select: { id: true, bond: true, contractorId: true },
    });
    expect(perfil?.bond).toBe("CONTRACTOR");
    expect(perfil?.contractorId).toBe(contratadaId);

    // A ficha e a lista mostram de que empresa a pessoa vem.
    const ficha = await request(app)
      .get(`/api/employee-profiles/${perfil!.id}/ficha`)
      .set(as(rh.token));
    expect(ficha.status).toBe(200);
    expect(ficha.body.profile.bond).toBe("CONTRACTOR");
    expect(ficha.body.profile.contractor.name).toContain("Limpeza Contratada");
  });

  it("empregado não pertence a empresa contratada", async () => {
    const naImportacao = await importar(rh.token, [
      {
        name: `Confuso Importada ${SUFIXO}`,
        bond: "EMPLOYEE",
        contractor_id: contratadaId,
      },
    ]);
    expect(naImportacao.body.created).toBe(0);
    expect((naImportacao.body.results as { message?: string }[])[0]!.message).toMatch(
      /[Ee]mpregado/,
    );

    const res = await importar(rh.token, [
      {
        name: `Vira Importada ${SUFIXO}`,
        email: `vira@${SUFIXO}.local`,
        bond: "TEMPORARY",
      },
    ]);
    const user = await prisma.user.findFirstOrThrow({
      where: { email: `vira@${SUFIXO}.local` },
      select: { id: true },
    });
    expect(res.body.created).toBe(1);
    const perfil = await prisma.employeeProfile.findFirstOrThrow({
      where: { organizationId: ORG_ID, userId: user.id },
      select: { id: true },
    });

    const naFicha = await request(app)
      .patch(`/api/employee-profiles/${perfil.id}`)
      .set(as(rh.token))
      .send({ bond: "EMPLOYEE", contractor_id: contratadaId });
    expect(naFicha.status).toBe(400);
    expect(naFicha.body.message).toMatch(/[Ee]mpregado/);
  });

  it("o RH muda o vínculo pela ficha", async () => {
    await importar(rh.token, [
      { name: `Promovida Importada ${SUFIXO}`, email: `promovida@${SUFIXO}.local` },
    ]);
    const user = await prisma.user.findFirstOrThrow({
      where: { email: `promovida@${SUFIXO}.local` },
      select: { id: true },
    });
    const perfil = await prisma.employeeProfile.findFirstOrThrow({
      where: { organizationId: ORG_ID, userId: user.id },
      select: { id: true, bond: true },
    });
    expect(perfil.bond).toBe("EMPLOYEE");

    const res = await request(app)
      .patch(`/api/employee-profiles/${perfil.id}`)
      .set(as(rh.token))
      .send({ bond: "APPRENTICE" });
    expect(res.status).toBe(200);
    expect(res.body.profile.bond).toBe("APPRENTICE");

    const invalido = await request(app)
      .patch(`/api/employee-profiles/${perfil.id}`)
      .set(as(rh.token))
      .send({ bond: "QUALQUER_COISA" });
    expect(invalido.status).toBe(400);
    expect(invalido.body.message).toMatch(/[Vv]ínculo inválido/);
  });
});
