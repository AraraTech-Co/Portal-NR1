import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Os dados da planilha da folha. [PF-2]
 *
 * Uma empresa do teste com a Loja e a AG. A importação grava RG, PIS,
 * endereço e o resto num registro à parte da ficha, e o CBO na função. Quem
 * lê: Master, Dono e RH; a pessoa, os próprios; mais ninguém.
 *
 * Apagada no fim.
 */
const SUFIXO = Date.now().toString(36);
const SENHA = ["pf2", "dados", "folha"].join("-");
const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let orgId = "";
let outraOrg = "";
let contaId = "";
let outraConta = "";
const usuarios: string[] = [];
const token: Record<string, string> = {};
let loja = "";
let ag = "";
let repositor = "";
let auxiliar = "";
let comCbo = "";

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

const ANA = cpf("611611611");
const BIA = cpf("622622622");

async function pessoa(chave: string, role: Role, org = orgId, conta = contaId, ficha?: { filial: string }) {
  const login = `pf2.${chave}.${SUFIXO}`;
  const user = await prisma.user.create({
    data: { login, name: `Pessoa ${chave}`, passwordHash: await bcrypt.hash(SENHA, 4) },
  });
  usuarios.push(user.id);
  await prisma.membership.create({ data: { userId: user.id, organizationId: org, role } });
  await prisma.accountMembership.create({ data: { accountId: conta, userId: user.id, role: AccountRole.USER } });
  if (ficha) {
    await prisma.employeeProfile.create({
      data: { organizationId: org, userId: user.id, establishmentId: ficha.filial, registration: `9${usuarios.length}` },
    });
  }
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  token[chave] = res.body.token;
  return user.id;
}

const importar = (people: Record<string, unknown>[], dry_run: boolean) =>
  request(app).post("/api/pessoas-acessos/importar").set(as(token.rh)).send({ people, dry_run });

const linhaAna = (payroll: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  name: "ANA DA FOLHA",
  registration: "000004",
  tax_id: ANA,
  job_role_id: repositor,
  establishment_id: loja,
  bond: "EMPLOYEE",
  payroll,
  job_role_cbo2002: "5211-25",
  job_role_cbo94: "0.11-05",
  ...extra,
});

const fichaDe = (taxId: string) =>
  prisma.employeeProfile.findFirstOrThrow({ where: { organizationId: orgId, taxId }, include: { payrollData: true } });

beforeAll(async () => {
  app = createApp();
  orgId = (await prisma.organization.create({ data: { name: `PF2 ${SUFIXO}` } })).id;
  contaId = (await prisma.account.create({ data: { organizationId: orgId, name: `Conta PF2 ${SUFIXO}` } })).id;
  outraOrg = (await prisma.organization.create({ data: { name: `PF2 Outra ${SUFIXO}` } })).id;
  outraConta = (await prisma.account.create({ data: { organizationId: outraOrg, name: `Conta PF2 Outra ${SUFIXO}` } })).id;

  for (const [nome, cargo, cbo] of [
    ["Loja", "REPOSITOR", null],
    ["AG", "AUXILIAR ADMINISTRATIVO", "4110-05"],
  ] as const) {
    const est = await prisma.establishment.create({ data: { organizationId: orgId, name: `${nome} ${SUFIXO}` } });
    const setor = await prisma.sector.create({ data: { organizationId: orgId, establishmentId: est.id, name: `Setor ${nome}` } });
    const f = await prisma.jobRole.create({
      data: { organizationId: orgId, sectorId: setor.id, name: cargo, cbo2002: cbo },
    });
    if (nome === "Loja") {
      loja = est.id;
      repositor = f.id;
    } else {
      ag = est.id;
      auxiliar = f.id;
      comCbo = f.id;
    }
  }

  await pessoa("rh", Role.RH);
  await pessoa("master", Role.MASTER);
  await pessoa("dono", Role.OWNER);
  await pessoa("sst", Role.SST);
  const rhId = usuarios[0]!;
  for (const [chave, role] of [["gerente", Role.GERENTE], ["admloja", Role.ADM_LOJA]] as const) {
    const userId = await pessoa(chave, role, orgId, contaId, { filial: loja });
    const m = await prisma.membership.findFirstOrThrow({ where: { userId, organizationId: orgId } });
    await prisma.managedEstablishment.create({
      data: { organizationId: orgId, membershipId: m.id, establishmentId: loja, createdById: rhId },
    });
  }
  await pessoa("rhfora", Role.RH, outraOrg, outraConta);
});

afterAll(async () => {
  for (const org of [orgId, outraOrg]) {
    if (!org) continue;
    await prisma.auditEvent.deleteMany({ where: { organizationId: org } });
    await prisma.employeePayrollData.deleteMany({ where: { organizationId: org } });
    await prisma.employeeProfile.deleteMany({ where: { organizationId: org } });
    await prisma.managedEstablishment.deleteMany({ where: { organizationId: org } });
    await prisma.membership.deleteMany({ where: { organizationId: org } });
  }
  const criados = await prisma.user.findMany({ where: { login: { startsWith: "ana.da.folha" } }, select: { id: true } });
  const ids = [...usuarios, ...criados.map((u) => u.id)];
  await prisma.accountMembership.deleteMany({ where: { accountId: { in: [contaId, outraConta] } } });
  await prisma.token.deleteMany({ where: { userId: { in: ids } } });
  await prisma.membership.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  for (const org of [orgId, outraOrg]) {
    if (!org) continue;
    await prisma.jobRole.deleteMany({ where: { organizationId: org } });
    await prisma.sector.deleteMany({ where: { organizationId: org } });
    await prisma.establishment.deleteMany({ where: { organizationId: org } });
    await prisma.account.deleteMany({ where: { organizationId: org } });
    await prisma.organization.deleteMany({ where: { id: org } });
  }
});

describe("a importação grava os dados da folha à parte, e o CBO na função [PF-2]", () => {
  it("a prévia não grava nada; o cadastro grava os dados da folha e completa o CBO vazio da função", async () => {
    const payroll = {
      competence: "2026-10",
      rg: "MG-1.234.567",
      pis: "12345678901",
      ctps_number: "65333",
      ctps_series: "0282",
      ctps_uf: "sp",
      salary_type: "M",
      fgts_option_date: "2018-06-19",
      dependents: "2",
      education_level: "7",
      nationality_code: "10",
      address: "R Manguezal, 78",
      district: "Jardim da Mata",
      city: "AMERICANA - SP",
    };
    const previa = await importar([linhaAna(payroll)], true);
    expect(previa.status, JSON.stringify(previa.body)).toBe(200);
    expect(previa.body.results[0].status).toBe("created");
    expect(await prisma.employeePayrollData.count({ where: { organizationId: orgId } })).toBe(0);
    expect((await prisma.jobRole.findUniqueOrThrow({ where: { id: repositor } })).cbo2002).toBeNull();

    const feito = await importar([linhaAna(payroll)], false);
    expect(feito.status, JSON.stringify(feito.body)).toBe(201);
    expect(feito.body.results[0].status).toBe("created");
    const ficha = await fichaDe(ANA);
    expect(ficha.payrollData).toMatchObject({
      organizationId: orgId,
      competence: "2026-10",
      rg: "MG-1.234.567",
      pis: "12345678901",
      ctpsUf: "SP",
      fgtsOptionDate: new Date("2018-06-19T00:00:00.000Z"),
      dependents: 2,
      educationLevel: "7",
      city: "AMERICANA - SP",
      terminationDate: null,
    });
    expect(await prisma.jobRole.findUniqueOrThrow({ where: { id: repositor } })).toMatchObject({
      cbo2002: "5211-25",
      cbo94: "0.11-05",
    });
  });

  it("a função que já tem CBO fica com o dela", async () => {
    const res = await importar(
      [
        {
          name: "BIA DA FOLHA",
          registration: "000004",
          tax_id: BIA,
          job_role_id: auxiliar,
          establishment_id: ag,
          job_role_cbo2002: "9999-99",
          payroll: { competence: "2026-10", rg: "123" },
        },
      ],
      false,
    );
    expect(res.body.results[0].status, JSON.stringify(res.body)).toBe("created");
    expect((await prisma.jobRole.findUniqueOrThrow({ where: { id: comCbo } })).cbo2002).toBe("4110-05");
  });

  it("de novo, com a folha seguinte: o que mudou grava por cima, célula em branco não apaga, e a trilha não guarda valores", async () => {
    const res = await importar(
      [linhaAna({ competence: "2026-11", address: "Av. Brasil, 100", district: "Centro", rg: "" })],
      false,
    );
    expect(res.body.results[0].status, JSON.stringify(res.body)).toBe("completed");
    expect(res.body.results[0].message).toBe(
      "Já estava no portal; a planilha completou: dados da folha (endereço, bairro).",
    );
    const ficha = await fichaDe(ANA);
    expect(ficha.payrollData).toMatchObject({
      competence: "2026-11",
      address: "Av. Brasil, 100",
      district: "Centro",
      rg: "MG-1.234.567",
      city: "AMERICANA - SP",
    });
    const trilha = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: orgId, action: "employee_payroll_data.update", entityId: ficha.id },
      orderBy: { createdAt: "desc" },
    });
    expect(trilha.after).toEqual({ via: "import", fields: ["endereço", "bairro"], competence: "2026-11" });
    expect(JSON.stringify(trilha)).not.toContain("Av. Brasil");
  });

  it("a prévia de quem já existe diz o que mudaria e não grava", async () => {
    const res = await importar([linhaAna({ competence: "2026-12", address: "Rua da Prévia, 9" })], true);
    expect(res.body.results[0]).toMatchObject({
      status: "completed",
      message: "Já estava no portal; a planilha completou: dados da folha (endereço).",
    });
    expect((await fichaDe(ANA)).payrollData).toMatchObject({ address: "Av. Brasil, 100", competence: "2026-11" });
  });

  it("uma folha mais velha que a guardada não mexe em nada, e a linha diz por quê", async () => {
    const res = await importar([linhaAna({ competence: "2026-09", address: "Rua Velha, 1" })], false);
    expect(res.body.results[0].status, JSON.stringify(res.body)).toBe("skipped");
    expect(res.body.results[0].message).toContain(
      "Os dados da folha do portal são de 11/2026, mais novos que os desta planilha: ficaram como estavam, e as diferenças desta planilha não são oferecidas.",
    );
    expect((await fichaDe(ANA)).payrollData?.address).toBe("Av. Brasil, 100");
  });

  it("dado da folha inválido volta na linha, com o motivo, e nada entra", async () => {
    const res = await importar(
      [{ name: "CAIO INVALIDO", tax_id: cpf("633633633"), job_role_id: repositor, payroll: { ctps_uf: "Sao Paulo" } }],
      true,
    );
    expect(res.body.results[0]).toMatchObject({ status: "error", message: "UF da CTPS: use a sigla do estado, como SP." });
  });
});

describe("quem vê e quem edita os dados da folha [PF-2]", () => {
  const ler = (quem: string, profileId: string) =>
    request(app).get(`/api/employee-profiles/${profileId}/dados-da-folha`).set(as(token[quem]!));
  const editar = (quem: string, profileId: string, corpo: Record<string, unknown>) =>
    request(app).patch(`/api/employee-profiles/${profileId}/dados-da-folha`).set(as(token[quem]!)).send(corpo);

  it("Master, Dono e RH leem e podem editar", async () => {
    const { id } = await fichaDe(ANA);
    for (const quem of ["rh", "master", "dono"]) {
      const res = await ler(quem, id);
      expect(res.status, quem).toBe(200);
      expect(res.body.pode_editar, quem).toBe(true);
      expect(res.body.dados).toMatchObject({ rg: "MG-1.234.567", fgts_option_date: "2018-06-19", competence: "2026-11" });
    }
  });

  it("gerente, ADM loja e SST da empresa, e o RH de outra empresa, recebem o mesmo 404 de ficha que não existe", async () => {
    const { id } = await fichaDe(ANA);
    for (const quem of ["gerente", "admloja", "sst", "rhfora"]) {
      const res = await ler(quem, id);
      expect(res.status, quem).toBe(404);
      expect(res.body).toEqual({ message: "Ficha não encontrada." });
      expect((await editar(quem, id, { rg: "1" })).status, quem).toBe(404);
    }
  });

  it("a pessoa lê os próprios dados e não edita", async () => {
    const ana = await fichaDe(ANA);
    const login = (await prisma.user.findUniqueOrThrow({ where: { id: ana.userId } })).login;
    await prisma.user.update({
      where: { id: ana.userId },
      data: { passwordHash: await bcrypt.hash(SENHA, 4), activatedAt: new Date(), firstAccessEligible: false },
    });
    const entrou = await request(app).post("/api/auth").send({ login, password: SENHA });
    expect(entrou.status, JSON.stringify(entrou.body)).toBe(200);
    token.ana = entrou.body.token;
    usuarios.push(ana.userId);

    const res = await ler("ana", ana.id);
    expect(res.status).toBe(200);
    expect(res.body.pode_editar).toBe(false);
    expect(res.body.dados.address).toBe("Av. Brasil, 100");
    const tenta = await editar("ana", ana.id, { address: "Rua Minha, 1" });
    expect(tenta.status).toBe(403);
    expect((await fichaDe(ANA)).payrollData?.address).toBe("Av. Brasil, 100");
  });

  it("o RH edita à mão: grava, não mexe na competência, e a trilha só diz os campos", async () => {
    const { id } = await fichaDe(ANA);
    const res = await editar("rh", id, { dependents: "3", ctps_uf: "rj", competence: "2030-01" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.mudou).toEqual(["UF da CTPS", "dependentes"]);
    expect(res.body.dados).toMatchObject({ dependents: 3, ctps_uf: "RJ", competence: "2026-11" });
    const trilha = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: orgId, action: "employee_payroll_data.update", entityId: id },
      orderBy: { createdAt: "desc" },
    });
    expect(trilha.after).toEqual({ via: "manual", fields: ["UF da CTPS", "dependentes"] });
  });

  it("valor inválido na edição volta 400 e não grava", async () => {
    const { id } = await fichaDe(ANA);
    const res = await editar("rh", id, { fgts_option_date: "31/02/2020" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("opção do FGTS: data inválida — esse dia não existe. Use dd/mm/aaaa.");
  });

  it("a ficha e a lista de colaboradores não carregam os dados da folha", async () => {
    const { id } = await fichaDe(ANA);
    const ficha = await request(app).get(`/api/employee-profiles/${id}/ficha`).set(as(token.rh!));
    expect(ficha.status).toBe(200);
    const lista = await request(app).get("/api/employee-profiles").set(as(token.rh!));
    expect(lista.status).toBe(200);
    for (const corpo of [ficha.body, lista.body]) {
      const texto = JSON.stringify(corpo);
      expect(texto).not.toContain("MG-1.234.567");
      expect(texto).not.toContain("Av. Brasil");
      expect(texto).not.toContain("payrollData");
    }
    expect(ficha.body.profile.jobRole.cbo2002).toBe("5211-25");
  });
});

describe("o CBO da função [PF-2]", () => {
  const editarFuncao = (quem: string, corpo: Record<string, unknown>) =>
    request(app).patch(`/api/job-roles/${repositor}`).set(as(token[quem]!)).send(corpo);

  it("o SST corrige o CBO; formato inválido é recusado; a lista de funções traz o CBO", async () => {
    const ok = await editarFuncao("sst", { cbo_2002: " 5211-30 ", cbo_94: null });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.job_role).toMatchObject({ cbo2002: "5211-30", cbo94: null });
    const ruim = await editarFuncao("sst", { cbo_2002: "repositor" });
    expect(ruim.status).toBe(400);
    expect(ruim.body.message).toBe("CBO 2002 inválido: use os números do código, como 5211-25.");
    const lista = await request(app).get("/api/job-roles").set(as(token.sst!));
    expect(lista.body.job_roles.find((f: { id: string }) => f.id === repositor)).toMatchObject({ cbo2002: "5211-30" });
  });

  it("o RH não edita a função, nem o CBO", async () => {
    expect((await editarFuncao("rh", { cbo_2002: "1111-11" })).status).toBe(403);
  });

  it("a ordem de serviço emitida daqui em diante traz o CBO da função", async () => {
    const res = await request(app)
      .post("/api/service-orders")
      .set(as(token.sst!))
      .send({ job_role_id: repositor, duties: "Usar os EPIs.", responsible_name: "Saulo SST" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const ordem = await prisma.serviceOrder.findFirstOrThrow({
      where: { organizationId: orgId, jobRoleId: repositor },
      orderBy: { version: "desc" },
    });
    expect((ordem.content as { job_role: Record<string, unknown> }).job_role).toMatchObject({
      name: "REPOSITOR",
      cbo2002: "5211-30",
      cbo94: null,
    });
    await prisma.serviceOrderAck.deleteMany({ where: { serviceOrderId: ordem.id } });
    await prisma.serviceOrder.deleteMany({ where: { organizationId: orgId } });
  });

  it("a cópia entre filiais leva o CBO junto com a função [C3-8]", async () => {
    const destino = await prisma.establishment.create({ data: { organizationId: orgId, name: `Nova ${SUFIXO}` } });
    const res = await request(app)
      .post(`/api/establishments/${destino.id}/copia`)
      .set(as(token.sst!))
      .send({ origem: loja });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const copiada = await prisma.jobRole.findFirstOrThrow({
      where: { organizationId: orgId, copiedFromId: repositor },
      select: { cbo2002: true, cbo94: true },
    });
    expect(copiada).toEqual({ cbo2002: "5211-30", cbo94: null });
    await prisma.establishmentCopy.deleteMany({ where: { organizationId: orgId } });
  });
});
