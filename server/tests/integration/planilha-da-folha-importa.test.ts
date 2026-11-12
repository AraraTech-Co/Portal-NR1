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
import { gerarXlsx, lerXlsx } from "../../../client/src/lib/xlsx";
import { importarEmLotes } from "../../../client/src/lib/importar-em-lotes";

/**
 * A planilha da folha, do arquivo ao cadastro. [PF-1]
 *
 * Uma empresa do teste com a Loja (código 0682) e a AG (0683), cada uma com
 * as funções que a folha escreve ("REPOSITORA" na loja, "AUXILIAR
 * ADMINISTRATIVO" na AG). A matrícula 000004 existe nas duas. O arquivo é um
 * .xlsx de verdade, lido como a tela lê, com as filiais e funções vindas das
 * mesmas rotas que a tela usa, e enviado em lotes.
 *
 * Apagada no fim.
 */
const SUFIXO = Date.now().toString(36);
const SENHA = ["pf1", "folha", "planilha"].join("-");
const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let orgId = "";
let contaId = "";
const usuarios: string[] = [];
let rhToken = "";
let sstToken = "";
const filial: Record<"loja" | "ag" | "fechada", string> = { loja: "", ag: "", fechada: "" };
const funcao: Record<"repositora" | "auxiliar", string> = { repositora: "", auxiliar: "" };

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

async function pessoa(nome: string, role: Role) {
  const login = `pf1.${nome.toLowerCase()}.${SUFIXO}`;
  const user = await prisma.user.create({
    data: { login, name: nome, passwordHash: await bcrypt.hash(SENHA, 4) },
  });
  usuarios.push(user.id);
  await prisma.membership.create({ data: { userId: user.id, organizationId: orgId, role } });
  await prisma.accountMembership.create({
    data: { accountId: contaId, userId: user.id, role: AccountRole.USER },
  });
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.token as string;
}

function linha(p: { cod: string; mat: string; nome: string; cpf: string; cargo: string }): string[] {
  const v: Record<string, string> = {
    "Cód. Empresa": p.cod,
    Empresa: "SUPER SHOPPING TESTE LTDA",
    Competência: "10/2026",
    "Cód. Func.": p.mat,
    Nome: p.nome,
    CPF: p.cpf,
    "Data Nasc.": "30827",
    Admissão: "43270",
    Cargo: p.cargo,
    Salário: "0",
  };
  return CABECALHO_DA_FOLHA.map((c) => v[c] ?? "");
}

/** Como a tela: lê o .xlsx, busca filiais e funções nas rotas, e envia em lotes. */
async function enviarPlanilha(xlsx: Uint8Array, simulacao: boolean, porLote = 200) {
  const [ests, funcs] = await Promise.all([
    request(app).get("/api/establishments").set(as(rhToken)),
    request(app).get("/api/job-roles").set(as(rhToken)),
  ]);
  expect(ests.status).toBe(200);
  expect(funcs.status).toBe(200);
  const filiais: FilialDaEmpresa[] = ests.body.establishments.map(
    (e: { id: string; name: string; taxId: string | null; payrollCode: string | null }) => ({
      id: e.id,
      name: e.name,
      taxId: e.taxId,
      payrollCode: e.payrollCode,
    }),
  );
  const lido = lerTabela(
    await lerXlsx(xlsx),
    funcs.body.job_roles as FuncaoDaEmpresa[],
    [],
    { papeis: { COLABORADOR: "Colaborador" }, vinculos: { EMPLOYEE: "Empregado" } },
    filiais,
  );
  const relatorio = await importarEmLotes(
    lido.rows,
    lido.numeros,
    async (lote) => {
      const res = await request(app)
        .post("/api/pessoas-acessos/importar")
        .set(as(rhToken))
        .send({ people: lote, dry_run: simulacao });
      expect(res.status, JSON.stringify(res.body)).toBe(simulacao ? 200 : 201);
      return res.body;
    },
    porLote,
  );
  return { lido, relatorio };
}

beforeAll(async () => {
  app = createApp();
  const org = await prisma.organization.create({ data: { name: `PF1 Folha ${SUFIXO}` } });
  orgId = org.id;
  contaId = (await prisma.account.create({ data: { organizationId: orgId, name: `Conta PF1 ${SUFIXO}` } })).id;

  for (const [chave, nome, codigo, cargo] of [
    ["loja", "Loja", "0682", "REPOSITORA"],
    ["ag", "AG", "0683", "AUXILIAR ADMINISTRATIVO"],
  ] as const) {
    const est = await prisma.establishment.create({
      data: { organizationId: orgId, name: `${nome} ${SUFIXO}`, payrollCode: codigo },
    });
    filial[chave] = est.id;
    const setor = await prisma.sector.create({
      data: { organizationId: orgId, establishmentId: est.id, name: `Setor ${nome}` },
    });
    const f = await prisma.jobRole.create({ data: { organizationId: orgId, sectorId: setor.id, name: cargo } });
    funcao[chave === "loja" ? "repositora" : "auxiliar"] = f.id;
  }
  filial.fechada = (
    await prisma.establishment.create({
      data: { organizationId: orgId, name: `Fechada ${SUFIXO}`, payrollCode: "0700", archivedAt: new Date() },
    })
  ).id;

  rhToken = await pessoa("Rita", Role.RH);
  sstToken = await pessoa("Saulo", Role.SST);
});

afterAll(async () => {
  if (!orgId) return;
  const membros = await prisma.membership.findMany({ where: { organizationId: orgId }, select: { userId: true } });
  const ids = [...new Set([...usuarios, ...membros.map((m) => m.userId)])];
  await prisma.auditEvent.deleteMany({ where: { organizationId: orgId } });
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

describe("a planilha da folha cadastra pela filial do código [PF-1]", () => {
  it("o .xlsx da folha entra: filial pelo Cód. Empresa, função pelo Cargo, matrícula com os zeros", async () => {
    const xlsx = gerarXlsx([
      [...CABECALHO_DA_FOLHA],
      linha({ cod: "0682", mat: "000004", nome: "ANA FOLHA", cpf: cpf("401401401"), cargo: "REPOSITORA" }),
      linha({ cod: "0683", mat: "000004", nome: "BIA FOLHA", cpf: cpf("402402402"), cargo: "AUXILIAR ADMINISTRATIVO" }),
    ]);
    const previa = await enviarPlanilha(xlsx, true);
    expect(previa.lido.problems).toEqual([]);
    expect(previa.relatorio).toMatchObject({ created: 2, errors: 0 });

    const feito = await enviarPlanilha(xlsx, false);
    expect(feito.relatorio).toMatchObject({ created: 2, errors: 0 });
    const fichas = await prisma.employeeProfile.findMany({
      where: { organizationId: orgId, registration: "000004" },
      select: { establishmentId: true, jobRoleId: true, bond: true, contractorId: true, birthDate: true, user: { select: { name: true, firstAccessEligible: true } } },
      orderBy: { user: { name: "asc" } },
    });
    expect(fichas).toEqual([
      {
        establishmentId: filial.loja,
        jobRoleId: funcao.repositora,
        bond: "EMPLOYEE",
        contractorId: null,
        birthDate: new Date("1984-05-25T00:00:00.000Z"),
        user: { name: "ANA FOLHA", firstAccessEligible: true },
      },
      {
        establishmentId: filial.ag,
        jobRoleId: funcao.auxiliar,
        bond: "EMPLOYEE",
        contractorId: null,
        birthDate: new Date("1984-05-25T00:00:00.000Z"),
        user: { name: "BIA FOLHA", firstAccessEligible: true },
      },
    ]);

    /* A mesma planilha de novo não cadastra ninguém outra vez. */
    const deNovo = await enviarPlanilha(xlsx, false);
    expect(deNovo.relatorio).toMatchObject({ created: 0, skipped: 2, errors: 0 });
  });

  it("a filial arquivada não aparece para a planilha: o código dela é 'de nenhuma filial'", async () => {
    const xlsx = gerarXlsx([
      [...CABECALHO_DA_FOLHA],
      linha({ cod: "0700", mat: "9", nome: "CAIO FECHADA", cpf: cpf("403403403"), cargo: "REPOSITORA" }),
    ]);
    const { lido, relatorio } = await enviarPlanilha(xlsx, true);
    expect(relatorio.rows).toBe(0);
    expect(lido.rows).toEqual([]);
    expect(lido.problems).toEqual([
      "Linha 2: código 0700 não é de nenhuma filial. Preencha o código da folha em Operação → Estabelecimentos.",
    ]);
  });

  it("em lotes: 5 pessoas em lotes de 2 dão 3 envios e o relatório aponta a linha do Excel", async () => {
    const linhas = [[...CABECALHO_DA_FOLHA]];
    for (let i = 0; i < 5; i++) {
      linhas.push(linha({ cod: "0682", mat: `90${i}`, nome: `LOTE PESSOA ${"ABCDE"[i]}`, cpf: cpf(`5${i}5${i}5${i}5${i}5`), cargo: "REPOSITORA" }));
    }
    linhas.splice(3, 0, []);
    const { relatorio } = await enviarPlanilha(gerarXlsx(linhas), true, 2);
    expect(relatorio).toMatchObject({ rows: 5, created: 5, errors: 0 });
    expect(relatorio.results.map((r: { line: number }) => r.line)).toEqual([2, 3, 5, 6, 7]);
  });
});

describe("o código da folha é de uma filial só [PF-1]", () => {
  const editar = (id: string, payroll_code: string | null) =>
    request(app).patch(`/api/establishments/${id}`).set(as(sstToken)).send({ payroll_code });

  it("outra filial com o mesmo código é recusada, também com ou sem os zeros da frente", async () => {
    for (const codigo of ["0682", "682", "000682"]) {
      const res = await editar(filial.ag, codigo);
      expect(res.status, codigo).toBe(400);
      expect(res.body.message).toBe(`O código da folha ${codigo} já é da filial Loja ${SUFIXO}. Cada filial tem o seu.`);
    }
    const ag = await prisma.establishment.findUnique({ where: { id: filial.ag }, select: { payrollCode: true } });
    expect(ag?.payrollCode).toBe("0683");
  });

  it("a própria filial grava o código dela de novo, e o código de uma filial arquivada fica livre", async () => {
    expect((await editar(filial.loja, "0682")).status).toBe(200);
    const res = await editar(filial.ag, "0700");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.establishment.payrollCode).toBe("0700");
    expect((await editar(filial.ag, "0683")).status).toBe(200);
  });
});
