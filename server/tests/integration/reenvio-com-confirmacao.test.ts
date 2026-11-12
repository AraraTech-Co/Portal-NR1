import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * A planilha enviada de novo, por cima de quem já existe. [PF-3]
 *
 * O que está em branco a planilha preenche; o que é diferente aparece na
 * prévia lado a lado e só muda se o RH marcar; matrícula e CPF nunca mudam.
 * Decisão do Leonardo em 12/11/2026.
 *
 * Empresa do teste com a Loja (REPOSITOR, com CBO, e REPOSITORA, sem) e a AG.
 * A Ana existe antes; cada teste a deixa como estava no começo.
 */
const SUFIXO = Date.now().toString(36);
const SENHA = ["pf3", "reenvio", "rh"].join("-");
const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let orgId = "";
let contaId = "";
const usuarios: string[] = [];
let rhToken = "";
let rhId = "";
let loja = "";
let repositor = "";
let repositora = "";
let anaUser = "";
let anaFicha = "";
let biaFicha = "";

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
const ANA = cpf("711711711");
const BIA = cpf("722722722");
const NASC = new Date("1984-05-25T00:00:00.000Z");
const ADM = new Date("2018-06-19T00:00:00.000Z");

const importar = (people: Record<string, unknown>[], dry_run: boolean) =>
  request(app).post("/api/pessoas-acessos/importar").set(as(rhToken)).send({ people, dry_run });

/** A linha da Ana como a planilha da folha traz, com o que o teste mudar. */
const ana = (extra: Record<string, unknown> = {}) => ({
  name: "ANA DA SILVA",
  registration: "000010",
  tax_id: ANA,
  birth_date: "1984-05-25",
  admitted_at: "2018-06-19",
  job_role_id: repositor,
  establishment_id: loja,
  bond: "EMPLOYEE",
  ...extra,
});

async function pessoaComFicha(nome: string, matricula: string, taxId: string, jobRoleId: string) {
  const user = await prisma.user.create({
    data: { login: `pf3.${matricula}.${SUFIXO}`, name: nome, passwordHash: await bcrypt.hash(SENHA, 4), activatedAt: new Date() },
  });
  usuarios.push(user.id);
  await prisma.membership.create({ data: { userId: user.id, organizationId: orgId, role: Role.COLABORADOR } });
  await prisma.accountMembership.create({ data: { accountId: contaId, userId: user.id, role: AccountRole.USER } });
  const ficha = await prisma.employeeProfile.create({
    data: { organizationId: orgId, userId: user.id, registration: matricula, taxId, birthDate: NASC, admittedAt: ADM, jobRoleId },
  });
  return { userId: user.id, fichaId: ficha.id };
}

beforeAll(async () => {
  app = createApp();
  orgId = (await prisma.organization.create({ data: { name: `PF3 ${SUFIXO}` } })).id;
  contaId = (await prisma.account.create({ data: { organizationId: orgId, name: `Conta PF3 ${SUFIXO}` } })).id;
  const est = await prisma.establishment.create({ data: { organizationId: orgId, name: `Loja ${SUFIXO}` } });
  loja = est.id;
  await prisma.establishment.create({ data: { organizationId: orgId, name: `AG ${SUFIXO}` } });
  const setor = await prisma.sector.create({ data: { organizationId: orgId, establishmentId: loja, name: "Loja" } });
  repositor = (await prisma.jobRole.create({ data: { organizationId: orgId, sectorId: setor.id, name: "REPOSITOR", cbo2002: "5211-25" } })).id;
  repositora = (await prisma.jobRole.create({ data: { organizationId: orgId, sectorId: setor.id, name: "REPOSITORA" } })).id;

  const rh = await prisma.user.create({
    data: { login: `pf3.rh.${SUFIXO}`, name: "Rita RH", passwordHash: await bcrypt.hash(SENHA, 4) },
  });
  usuarios.push(rh.id);
  rhId = rh.id;
  await prisma.membership.create({ data: { userId: rh.id, organizationId: orgId, role: Role.RH } });
  await prisma.accountMembership.create({ data: { accountId: contaId, userId: rh.id, role: AccountRole.USER } });
  const res = await request(app).post("/api/auth").send({ login: `pf3.rh.${SUFIXO}`, password: SENHA });
  expect(res.status).toBe(200);
  rhToken = res.body.token;

  ({ userId: anaUser, fichaId: anaFicha } = await pessoaComFicha("Ana da Silva", "000010", ANA, repositor));
  ({ fichaId: biaFicha } = await pessoaComFicha("Bia Souza", "000020", BIA, repositor));
});

/* A Ana volta ao começo antes de cada teste. */
beforeEach(async () => {
  if (!anaUser) return;
  await prisma.user.update({ where: { id: anaUser }, data: { name: "Ana da Silva" } });
  await prisma.employeeProfile.update({
    where: { id: anaFicha },
    data: { birthDate: NASC, admittedAt: ADM, jobRoleId: repositor, dismissedAt: null, dismissalReason: null, dismissedById: null },
  });
  await prisma.membership.updateMany({
    where: { userId: anaUser, organizationId: orgId },
    data: { suspendedAt: null, suspensionReason: null, suspendedById: null },
  });
  await prisma.jobRole.update({ where: { id: repositor }, data: { cbo2002: "5211-25" } });
});

afterAll(async () => {
  if (!orgId) return;
  await prisma.auditEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.employeePayrollData.deleteMany({ where: { organizationId: orgId } });
  await prisma.employeeProfile.deleteMany({ where: { organizationId: orgId } });
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

const estadoDaAna = async () => {
  const f = await prisma.employeeProfile.findUniqueOrThrow({
    where: { id: anaFicha },
    select: { birthDate: true, admittedAt: true, jobRoleId: true, dismissedAt: true, dismissalReason: true, registration: true, taxId: true, user: { select: { name: true } } },
  });
  return f;
};

describe("o que é diferente do portal espera o RH [PF-3]", () => {
  it("a mesma pessoa, com o nome em maiúsculas, não é diferença", async () => {
    const res = await importar([ana()], true);
    expect(res.body.results[0]).toMatchObject({ status: "skipped" });
    expect(res.body.results[0].divergences).toBeUndefined();
  });

  it("a prévia mostra lado a lado o que difere, e nada muda", async () => {
    const res = await importar(
      [ana({ name: "ANA DA SILVA SOUZA", birth_date: "1984-05-26", admitted_at: "2019-01-02", job_role_id: repositora })],
      true,
    );
    expect(res.body.results[0].status).toBe("skipped");
    expect(res.body.results[0].message).toBe("Já cadastrado (Ana da Silva); a planilha traz 4 dados diferentes do portal.");
    expect(res.body.results[0].divergences).toEqual([
      { campo: "name", rotulo: "nome", portal: "Ana da Silva", planilha: "ANA DA SILVA SOUZA" },
      { campo: "birth_date", rotulo: "nascimento", portal: "25/05/1984", planilha: "26/05/1984" },
      { campo: "admitted_at", rotulo: "admissão", portal: "19/06/2018", planilha: "02/01/2019" },
      { campo: "job_role", rotulo: "função", portal: "REPOSITOR", planilha: "REPOSITORA" },
    ]);
    expect(await estadoDaAna()).toMatchObject({ birthDate: NASC, jobRoleId: repositor, user: { name: "Ana da Silva" } });
  });

  it("gravar sem marcar nada não muda nada, e a linha continua dizendo o que difere", async () => {
    const res = await importar([ana({ name: "ANA DA SILVA SOUZA", job_role_id: repositora })], false);
    expect(res.body.results[0].status).toBe("skipped");
    expect(res.body.results[0].divergences.map((d: { campo: string }) => d.campo)).toEqual(["name", "job_role"]);
    expect(await estadoDaAna()).toMatchObject({ jobRoleId: repositor, user: { name: "Ana da Silva" } });
  });

  it("gravar com marcas muda só o que foi marcado, e a trilha diz o que o RH confirmou", async () => {
    const res = await importar(
      [ana({ name: "ANA DA SILVA SOUZA", birth_date: "1984-05-26", job_role_id: repositora, aceitar: ["name", "job_role"] })],
      false,
    );
    expect(res.body.results[0]).toMatchObject({
      status: "completed",
      message: "Já estava no portal; a planilha completou: nome (confirmado pelo RH), função (confirmado pelo RH).",
    });
    expect(res.body.results[0].divergences.map((d: { campo: string }) => d.campo)).toEqual(["birth_date"]);
    expect(await estadoDaAna()).toMatchObject({
      birthDate: NASC,
      jobRoleId: repositora,
      user: { name: "ANA DA SILVA SOUZA" },
    });
    const trilha = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: orgId, entityId: anaFicha, action: "employee_profile.update" },
      orderBy: { createdAt: "desc" },
    });
    expect(trilha.after).toEqual({ via: "import", confirmed: ["name", "job_role"] });
  });

  it("marca enviada na prévia não grava", async () => {
    const res = await importar([ana({ name: "ANA DA SILVA SOUZA", aceitar: ["name"] })], true);
    expect(res.body.results[0].status).toBe("completed");
    expect((await estadoDaAna()).user.name).toBe("Ana da Silva");
  });

  it("marca de um campo que não difere é ignorada", async () => {
    const res = await importar([ana({ aceitar: ["name", "birth_date", "rescisao"] })], false);
    expect(res.body.results[0].status).toBe("skipped");
    expect(await estadoDaAna()).toMatchObject({ dismissedAt: null, user: { name: "Ana da Silva" } });
  });

  it("CBO diferente na função: espera o RH; marcado, muda a função", async () => {
    const previa = await importar([ana({ job_role_cbo2002: "5211-99" })], true);
    expect(previa.body.results[0].divergences).toEqual([
      { campo: "cbo2002", rotulo: "CBO 2002 da função", portal: "5211-25", planilha: "5211-99" },
    ]);
    expect((await prisma.jobRole.findUniqueOrThrow({ where: { id: repositor } })).cbo2002).toBe("5211-25");
    await importar([ana({ job_role_cbo2002: "5211-99", aceitar: ["cbo2002"] })], false);
    expect((await prisma.jobRole.findUniqueOrThrow({ where: { id: repositor } })).cbo2002).toBe("5211-99");
  });

  it("rescisão na planilha: espera o RH; marcada, desliga com data e causa, e o acesso cai junto", async () => {
    const payroll = { competence: "2026-11", termination_date: "2026-11-30", termination_cause: "Pedido de demissão" };
    const previa = await importar([ana({ payroll })], true);
    expect(previa.body.results[0].divergences).toContainEqual({
      campo: "rescisao",
      rotulo: "rescisão",
      portal: "ativa no portal",
      planilha: "rescisão em 30/11/2026 (Pedido de demissão): desligar",
    });
    expect((await estadoDaAna()).dismissedAt).toBeNull();

    await prisma.token.create({
      data: { userId: anaUser, tokenHash: `pf3-${SUFIXO}`, expiresAt: new Date(Date.now() + 3600_000) },
    });
    expect(await prisma.token.count({ where: { userId: anaUser } })).toBe(1);
    const res = await importar([ana({ payroll, aceitar: ["rescisao"] })], false);
    expect(res.body.results[0].status, JSON.stringify(res.body)).toBe("completed");
    expect(await estadoDaAna()).toMatchObject({
      dismissedAt: new Date("2026-11-30T00:00:00.000Z"),
      dismissalReason: "Pedido de demissão",
    });
    const vinculo = await prisma.membership.findFirstOrThrow({ where: { userId: anaUser, organizationId: orgId } });
    expect(vinculo.suspensionReason).toBe("DISMISSAL");
    expect(await prisma.token.count({ where: { userId: anaUser } })).toBe(0);
    const trilha = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: orgId, entityId: anaFicha, action: "employee_profile.dismiss" },
    });
    expect(trilha.after).toMatchObject({ via: "import", confirmed: ["rescisao"] });
  });

  it("rescisão de quem já está desligado no portal não pede para desligar de novo", async () => {
    await prisma.employeeProfile.update({
      where: { id: anaFicha },
      data: { dismissedAt: new Date("2026-11-30T00:00:00.000Z"), dismissalReason: "Pedido", dismissedById: rhId },
    });
    const res = await importar([ana({ payroll: { termination_date: "2026-11-30" } })], true);
    expect(res.body.results[0].divergences).toBeUndefined();
  });

  it("rescisão anterior à admissão volta com o motivo e nada muda", async () => {
    const res = await importar(
      [ana({ payroll: { termination_date: "2017-01-01" }, aceitar: ["rescisao"] })],
      false,
    );
    expect(res.body.results[0]).toMatchObject({
      status: "error",
      message: "A rescisão da planilha é anterior à admissão: confira. Nada mudou.",
    });
    expect((await estadoDaAna()).dismissedAt).toBeNull();
  });

  it("a própria rescisão o RH não desliga pela planilha", async () => {
    await prisma.employeeProfile.create({
      data: { organizationId: orgId, userId: rhId, registration: "000099", taxId: cpf("799799799"), admittedAt: ADM, jobRoleId: repositor },
    });
    const res = await importar(
      [{ name: "Rita RH", registration: "000099", tax_id: cpf("799799799"), job_role_id: repositor, payroll: { termination_date: "2026-11-30" }, aceitar: ["rescisao"] }],
      false,
    );
    expect(res.body.results[0]).toMatchObject({
      status: "error",
      message: "A planilha traz a sua rescisão: outra pessoa do RH registra o seu desligamento.",
    });
  });
});

describe("matrícula e CPF dizem quem é a pessoa e nunca mudam [PF-3]", () => {
  it("CPF da Ana com outra matrícula: a linha vai para o RH e nada muda", async () => {
    const res = await importar([ana({ registration: "000077", name: "OUTRO NOME", aceitar: ["name"] })], false);
    expect(res.body.results[0]).toMatchObject({
      status: "error",
      message: "Ana da Silva tem a matrícula 000010 no portal, e a planilha diz 000077: confira. Nada mudou.",
    });
    expect(await estadoDaAna()).toMatchObject({ registration: "000010", user: { name: "Ana da Silva" } });
  });

  it("matrícula da Ana com outro CPF: a linha vai para o RH", async () => {
    const res = await importar([ana({ tax_id: cpf("733733733") })], true);
    expect(res.body.results[0]).toMatchObject({
      status: "error",
      message: "Ana da Silva tem outro CPF no portal: confira a planilha. Nada mudou.",
    });
  });

  it("CPF de uma pessoa e matrícula de outra: a linha diz as duas", async () => {
    const res = await importar([ana({ registration: "000020" })], true);
    expect(res.body.results[0]).toMatchObject({
      status: "error",
      message: "O CPF é de Ana da Silva e a matrícula é de Bia Souza: confira a planilha. Nada mudou.",
    });
    expect(biaFicha).toBeTruthy();
  });
});

describe("datas inválidas pedem dd/mm/aaaa [C4-3]", () => {
  it("dia que não existe é recusado, com o formato do modelo; dd/mm/aaaa direto é aceito", async () => {
    const ruim = await importar([{ name: "DATA RUIM", tax_id: cpf("744744744"), admitted_at: "2020-02-31", job_role_id: repositor }], true);
    expect(ruim.body.results[0]).toMatchObject({
      status: "error",
      message: "Data de admissão inválida — esse dia não existe. Use dd/mm/aaaa.",
    });
    const texto = await importar([{ name: "DATA TEXTO", tax_id: cpf("755755755"), admitted_at: "amanhã", job_role_id: repositor }], true);
    expect(texto.body.results[0].message).toBe("Data de admissão inválida — use dd/mm/aaaa.");
    const br = await importar([{ name: "DATA BR", tax_id: cpf("766766766"), admitted_at: "1/2/2020", job_role_id: repositor }], true);
    expect(br.body.results[0].status).toBe("created");
  });
});

describe("idade fora do comum avisa, sem bloquear [C4-8]", () => {
  it("nascimento que dá 6 anos entra com o aviso; um comum, sem", async () => {
    const res = await importar(
      [
        { name: "IDADE ESTRANHA", tax_id: cpf("777177717"), birth_date: "2020-01-05", job_role_id: repositor },
        { name: "IDADE COMUM", tax_id: cpf("788188818"), birth_date: "1990-01-05", job_role_id: repositor },
      ],
      true,
    );
    expect(res.body.results[0].status).toBe("created");
    expect(res.body.results[0].message).toMatch(/^Pronto para entrar\. Idade calculada: \d+ anos\. Confira a data\.$/);
    expect(res.body.results[1].message).toBe("Pronto para entrar.");
  });
});
