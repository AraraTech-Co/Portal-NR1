import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import {
  CABECALHO_DA_FOLHA,
  lerTabela,
  type FilialDaEmpresa,
  type FuncaoDaEmpresa,
} from "../../../client/src/lib/planilha";

/**
 * Cadastrar primeiro, as funções depois (decisão do Léo, 13/11).
 *
 * A pessoa cujo cargo ainda não é função na filial entra sem função — a
 * leitura da planilha manda a linha sem `job_role_id`. Depois que o SST
 * cadastra a função, reenviar a mesma linha preenche a função de quem está
 * sem, e não mexe no resto nem muda a filial.
 *
 * Empresa própria do teste com a Loja e a AG; apagada no fim.
 */
const SUFIXO = Date.now().toString(36);
const SENHA = ["sem", "funcao", "depois"].join("-");
const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let orgId = "";
let contaId = "";
const usuarios: string[] = [];
let rhToken = "";
let loja = "";

function cpf(base9: string): string {
  const d = base9.split("").map(Number);
  const dv = (n: number) => {
    const r = (d.slice(0, n).reduce((t, x, i) => t + x * (n + 1 - i), 0) * 10) % 11;
    return r === 10 ? 0 : r;
  };
  d.push(dv(9));
  d.push(dv(10));
  return d.join("");
}
const BIA = cpf("135792468");

const linhaDaBia = (extra: Record<string, unknown> = {}) => ({
  name: "BIA SEM FUNCAO",
  registration: "000077",
  tax_id: BIA,
  birth_date: "1990-04-02",
  admitted_at: "2024-02-01",
  establishment_id: loja,
  bond: "EMPLOYEE",
  ...extra,
});

const importar = (people: Record<string, unknown>[], dry_run: boolean) =>
  request(app).post("/api/pessoas-acessos/importar").set(as(rhToken)).send({ people, dry_run });

beforeAll(async () => {
  app = createApp();
  orgId = (await prisma.organization.create({ data: { name: `SEMF ${SUFIXO}` } })).id;
  contaId = (await prisma.account.create({ data: { organizationId: orgId, name: `Conta SEMF ${SUFIXO}` } })).id;
  loja = (await prisma.establishment.create({ data: { organizationId: orgId, name: `Loja ${SUFIXO}` } })).id;
  await prisma.establishment.create({ data: { organizationId: orgId, name: `AG ${SUFIXO}` } });
  const rh = await prisma.user.create({
    data: { login: `semf.rh.${SUFIXO}`, name: "Rita RH", passwordHash: await bcrypt.hash(SENHA, 4) },
  });
  usuarios.push(rh.id);
  await prisma.membership.create({ data: { userId: rh.id, organizationId: orgId, role: Role.RH } });
  await prisma.accountMembership.create({ data: { accountId: contaId, userId: rh.id, role: AccountRole.USER } });
  const res = await request(app).post("/api/auth").send({ login: `semf.rh.${SUFIXO}`, password: SENHA });
  expect(res.status).toBe(200);
  rhToken = res.body.token;
});

afterAll(async () => {
  if (!orgId) return;
  const fichas = await prisma.employeeProfile.findMany({ where: { organizationId: orgId }, select: { userId: true } });
  const ids = [...usuarios, ...fichas.map((f) => f.userId)];
  await prisma.auditEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.employeePayrollData.deleteMany({ where: { organizationId: orgId } });
  await prisma.employeeProfile.deleteMany({ where: { organizationId: orgId } });
  await prisma.accountMembership.deleteMany({ where: { accountId: contaId } });
  await prisma.membership.deleteMany({ where: { organizationId: orgId } });
  await prisma.token.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.jobRole.deleteMany({ where: { organizationId: orgId } });
  await prisma.sector.deleteMany({ where: { organizationId: orgId } });
  await prisma.establishment.deleteMany({ where: { organizationId: orgId } });
  await prisma.account.deleteMany({ where: { id: contaId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
});

describe("cadastrar primeiro, as funções depois", () => {
  it("sem a função, a pessoa entra na filial da linha, sem função", async () => {
    const res = await importar([linhaDaBia()], false);
    expect(res.body.results[0].status, JSON.stringify(res.body)).toBe("created");
    const ficha = await prisma.employeeProfile.findFirstOrThrow({ where: { organizationId: orgId, taxId: BIA } });
    expect([ficha.jobRoleId, ficha.establishmentId]).toEqual([null, loja]);
  });

  it("cadastrada a função, reenviar a mesma linha preenche a função e não mexe no resto", async () => {
    const setor = await prisma.sector.create({ data: { organizationId: orgId, establishmentId: loja, name: "Loja" } });
    const repositora = (
      await prisma.jobRole.create({ data: { organizationId: orgId, sectorId: setor.id, name: "REPOSITORA" } })
    ).id;

    const previa = await importar([linhaDaBia({ job_role_id: repositora })], true);
    expect(previa.body.results[0]).toMatchObject({ status: "completed" });
    expect(previa.body.results[0].filled).toEqual(["função"]);
    expect((await prisma.employeeProfile.findFirstOrThrow({ where: { organizationId: orgId, taxId: BIA } })).jobRoleId).toBeNull();

    const res = await importar([linhaDaBia({ job_role_id: repositora })], false);
    expect(res.body.results[0]).toMatchObject({ status: "completed" });
    const ficha = await prisma.employeeProfile.findFirstOrThrow({
      where: { organizationId: orgId, taxId: BIA },
      select: { jobRoleId: true, establishmentId: true, registration: true, user: { select: { name: true } } },
    });
    expect(ficha).toEqual({
      jobRoleId: repositora,
      establishmentId: loja,
      registration: "000077",
      user: { name: "BIA SEM FUNCAO" },
    });
  });
});

describe("o CBO de um cargo que não virou função não vai para a função que a pessoa já tem", () => {
  /*
    A Maria é CAIXA, sem CBO. A planilha da folha diz cargo "OPERADORA DE
    LOJA", que não é função, com CBO 4211-25. A linha passa pela leitura da
    tela (a mesma do navegador) antes de ir ao servidor: sem isso, o CBO do
    cargo chegaria sem a função e seria gravado na CAIXA, de todos que a têm.
  */
  const MARIA = cpf("864209753");
  let caixa = "";

  const linha = (cargo: string) => {
    const valores: Record<string, string> = {
      "Cód. Empresa": "0682",
      Empresa: "LOJA DO TESTE LTDA",
      Competência: "11/2026",
      "Cód. Func.": "000088",
      Nome: "MARIA DA CAIXA",
      CPF: MARIA,
      "Data Nasc.": "04/03/1985",
      Admissão: "01/02/2020",
      Cargo: cargo,
      "CBO 94": "4-22.15",
      "CBO 2002": "4211-25",
    };
    return CABECALHO_DA_FOLHA.map((c) => valores[c] ?? "");
  };

  const lerComoATela = async (cargo: string) => {
    const funcoes = await prisma.jobRole.findMany({
      where: { organizationId: orgId, archivedAt: null },
      select: { id: true, name: true, sector: { select: { establishment: { select: { id: true, name: true } } } } },
    });
    const est = await prisma.establishment.findUniqueOrThrow({ where: { id: loja } });
    const filiais: FilialDaEmpresa[] = [{ id: est.id, name: est.name, taxId: null, payrollCode: est.payrollCode }];
    return lerTabela(
      [[...CABECALHO_DA_FOLHA], linha(cargo)],
      funcoes.map((f) => ({ id: f.id, name: f.name, establishment: f.sector.establishment })) as FuncaoDaEmpresa[],
      [],
      { papeis: {}, vinculos: { EMPLOYEE: "Empregado" } },
      filiais,
    );
  };

  beforeAll(async () => {
    await prisma.establishment.update({ where: { id: loja }, data: { payrollCode: "0682" } });
    const setor = await prisma.sector.create({ data: { organizationId: orgId, establishmentId: loja, name: "Frente" } });
    caixa = (await prisma.jobRole.create({ data: { organizationId: orgId, sectorId: setor.id, name: "CAIXA" } })).id;
    const user = await prisma.user.create({
      data: { login: `semf.maria.${SUFIXO}`, name: "MARIA DA CAIXA", passwordHash: await bcrypt.hash(SENHA, 4), activatedAt: new Date() },
    });
    usuarios.push(user.id);
    await prisma.membership.create({ data: { userId: user.id, organizationId: orgId, role: Role.COLABORADOR } });
    await prisma.accountMembership.create({ data: { accountId: contaId, userId: user.id, role: AccountRole.USER } });
    await prisma.employeeProfile.create({
      data: {
        organizationId: orgId,
        userId: user.id,
        registration: "000088",
        taxId: MARIA,
        jobRoleId: caixa,
        birthDate: new Date("1985-03-04T00:00:00Z"),
        admittedAt: new Date("2020-02-01T00:00:00Z"),
      },
    });
  });

  it("a leitura tira o CBO junto com a função que não existe", async () => {
    const lido = await lerComoATela("OPERADORA DE LOJA");
    expect(lido.semFuncao).toEqual([2]);
    expect(lido.rows[0]).not.toHaveProperty("job_role_cbo2002");
    expect(lido.rows[0]).not.toHaveProperty("job_role_cbo94");
  });

  it("nem a prévia nem a gravação mexem no CBO da CAIXA, e não há diferença de CBO a oferecer", async () => {
    const lido = await lerComoATela("OPERADORA DE LOJA");
    for (const dry of [true, false]) {
      const res = await importar(lido.rows as Record<string, unknown>[], dry);
      const r = res.body.results[0];
      expect(r.status, JSON.stringify(r)).not.toBe("error");
      expect((r.divergences ?? []).map((d: { campo: string }) => d.campo)).not.toContain("cbo2002");
      expect((r.divergences ?? []).map((d: { campo: string }) => d.campo)).not.toContain("cbo94");
    }
    const funcao = await prisma.jobRole.findUniqueOrThrow({ where: { id: caixa } });
    expect([funcao.cbo2002, funcao.cbo94]).toEqual([null, null]);
    expect(
      await prisma.auditEvent.count({ where: { organizationId: orgId, action: "job_role.update", entityId: caixa } }),
    ).toBe(0);
  });

  it("com o cargo que É a função, o CBO da planilha completa a função vazia, como antes", async () => {
    const lido = await lerComoATela("CAIXA");
    expect(lido.semFuncao).toEqual([]);
    await importar(lido.rows as Record<string, unknown>[], false);
    expect((await prisma.jobRole.findUniqueOrThrow({ where: { id: caixa } })).cbo2002).toBe("4211-25");
  });
});
