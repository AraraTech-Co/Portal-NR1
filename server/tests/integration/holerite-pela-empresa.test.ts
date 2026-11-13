import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { rmSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { uploadsRoot } from "../../src/helper/uploads";
import { pdfDePaginas } from "../helpers/pdf";

/**
 * O holerite é conferido pela empresa que paga, e depois pela matrícula:
 * código da folha > matrícula (decisão do Léo, 12/11). [C3-3]
 *
 * Empresa própria do teste com a Loja (código 0682) e a AG (código 0683). A
 * matrícula 153 existe nas duas, de pessoas com o MESMO nome — só a empresa
 * impressa no cabeçalho desempata. O Otto gere só a Loja.
 *
 * Apagada no fim, com os arquivos gravados.
 */
const SUFIXO = Date.now().toString(36);
const SENHA = ["hol", "empresa", "folha"].join("-");
const COMPETENCIA = "OUTUBRO/2026";
const NOME = "Maria Souza Lima";

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let orgId = "";
let contaId = "";
const usuarios: string[] = [];
let loja = { id: "", nome: "" };
let ag = { id: "", nome: "" };
const pessoa: Record<string, string> = {};
let rhToken = "";
let admLoja = "";

/** Uma página da folha no layout IOB, com o cabeçalho da empresa e o CNPJ. */
const pagina = (codigo: string | null, matricula: string, nome = NOME.toUpperCase()) => [
  ...(codigo
    ? [`${codigo} - EMPRESA TESTE LTDA`, "R DAS FLORES, 260 - AMERICANA", "11.222.333/0001-44"]
    : ["EMPRESA TESTE LTDA"]),
  COMPETENCIA,
  "Data do Credito: 05/11/2026",
  "Codigo - Nome do Funcionario   Data Admissao",
  `${matricula} - ${nome}   15/01/2024`,
  "0001 SALARIO   30,00   3.000,00",
  "TOTAL LIQUIDO 2.450,00",
];

const lote = (pdf: Buffer, extra: Record<string, unknown> = {}) => ({
  reference_month: 10,
  reference_year: 2026,
  file_name: "folha-outubro.pdf",
  mime_type: "application/pdf",
  content_base64: pdf.toString("base64"),
  ...extra,
});

type Parte = { situacao: string; user_id: string | null; motivos: string[] };

async function previa(token: string, paginas: string[][], extra: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/payslips/lote/previa")
    .set(as(token))
    .send(lote(await pdfDePaginas(paginas), extra));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.parts as Parte[];
}

async function novaFilial(nome: string, payrollCode: string) {
  const est = await prisma.establishment.create({
    data: { organizationId: orgId, name: `${nome} ${SUFIXO}`, payrollCode },
  });
  return { id: est.id, nome: est.name };
}

async function novaPessoa(apelido: string, nome: string, role: Role, ficha?: { matricula: string; filial: string }) {
  const login = `hol.${apelido}.${SUFIXO}`.toLowerCase();
  const user = await prisma.user.create({
    data: { login, name: nome, passwordHash: await bcrypt.hash(SENHA, 4) },
  });
  usuarios.push(user.id);
  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId: orgId, role },
  });
  await prisma.accountMembership.create({
    data: { accountId: contaId, userId: user.id, role: AccountRole.USER },
  });
  if (ficha) {
    await prisma.employeeProfile.create({
      data: { organizationId: orgId, userId: user.id, registration: ficha.matricula, establishmentId: ficha.filial },
    });
  }
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { id: user.id, token: res.body.token as string, membershipId: membership.id };
}

beforeAll(async () => {
  app = createApp();
  orgId = (await prisma.organization.create({ data: { name: `HOL ${SUFIXO}` } })).id;
  contaId = (await prisma.account.create({ data: { organizationId: orgId, name: `Conta HOL ${SUFIXO}` } })).id;
  loja = await novaFilial("Loja", "0682");
  ag = await novaFilial("AG", "0683");

  const rh = await novaPessoa("rita", "Rita do RH", Role.RH);
  rhToken = rh.token;
  /* A mesma matrícula e o mesmo nome nas duas filiais: pessoas diferentes. */
  pessoa.daLoja = (await novaPessoa("maria1", NOME, Role.COLABORADOR, { matricula: "153", filial: loja.id })).id;
  pessoa.daAg = (await novaPessoa("maria2", NOME, Role.COLABORADOR, { matricula: "000153", filial: ag.id })).id;

  const adm = await novaPessoa("otto", "Otto Adm", Role.ADM_LOJA);
  await prisma.managedEstablishment.create({
    data: { organizationId: orgId, membershipId: adm.membershipId, establishmentId: loja.id, createdById: rh.id },
  });
  admLoja = adm.token;
});

afterAll(async () => {
  if (!orgId) return;
  await prisma.notification.deleteMany({ where: { organizationId: orgId } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.payslipVersion.deleteMany({ where: { payslip: { organizationId: orgId } } });
  await prisma.payslip.deleteMany({ where: { organizationId: orgId } });
  await prisma.employeeProfile.deleteMany({ where: { organizationId: orgId } });
  await prisma.managedEstablishment.deleteMany({ where: { organizationId: orgId } });
  await prisma.accountMembership.deleteMany({ where: { accountId: contaId } });
  await prisma.membership.deleteMany({ where: { organizationId: orgId } });
  await prisma.token.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.establishment.deleteMany({ where: { organizationId: orgId } });
  await prisma.account.deleteMany({ where: { id: contaId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  rmSync(join(uploadsRoot(), orgId), { recursive: true, force: true });
});

describe("o lote acha a filial pelo código da empresa [C3-3]", () => {
  it("a tela sabe que há filiais e que todas têm o código; a lista não traz o código", async () => {
    const res = await request(app).get("/api/payslips/lote/filiais").set(as(rhToken));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.por_filial).toBe(true);
    expect(res.body.com_codigo).toBe(true);
    expect(Object.keys(res.body.filiais[0]).sort()).toEqual(["id", "name"]);
  });

  it("sem o código numa filial, a tela pede a escolha", async () => {
    await prisma.establishment.update({ where: { id: ag.id }, data: { payrollCode: null } });
    try {
      const res = await request(app).get("/api/payslips/lote/filiais").set(as(rhToken));
      expect(res.body.com_codigo).toBe(false);
    } finally {
      await prisma.establishment.update({ where: { id: ag.id }, data: { payrollCode: "0683" } });
    }
  });

  it("sem escolher filial, a mesma matrícula vai para a pessoa da empresa impressa", async () => {
    const partes = await previa(rhToken, [pagina("0682", "000153"), pagina("683", "153")]);
    expect(partes.map((p) => [p.situacao, p.user_id])).toEqual([
      ["CONFERE", pessoa.daLoja],
      ["CONFERE", pessoa.daAg],
    ]);
  });

  it("com a Loja escolhida, a página da AG não confere e diz por quê", async () => {
    const [daAg, daLoja] = await previa(rhToken, [pagina("0683", "153"), pagina("0682", "153")], {
      establishment_id: loja.id,
    });
    expect(daAg.situacao).toBe("NAO_CONFERE");
    expect(daAg.user_id).toBeNull();
    expect(daAg.motivos).toEqual([
      `Esta página é da empresa código 0683, e a filial escolhida, ${loja.nome}, tem o código 0682.`,
    ]);
    expect([daLoja.situacao, daLoja.user_id]).toEqual(["CONFERE", pessoa.daLoja]);
  });

  it("código que nenhuma filial tem fica de fora com o que fazer", async () => {
    const [parte] = await previa(rhToken, [pagina("0999", "153")]);
    expect(parte.situacao).toBe("SEM_CADASTRO");
    expect(parte.user_id).toBeNull();
    expect(parte.motivos).toEqual([
      "Nenhuma filial tem o código da folha 0999. Preencha o código na filial ou escolha a filial da folha.",
    ]);
  });

  it("página sem o cabeçalho da empresa e sem filial escolhida: pede a filial", async () => {
    const [parte] = await previa(rhToken, [pagina(null, "153")]);
    expect(parte.situacao).toBe("SEM_CADASTRO");
    expect(parte.motivos).toEqual([
      "Não encontrei o código da empresa nesta página. Escolha a filial da folha e confira de novo.",
    ]);
    /* Com a filial escolhida, a página sem cabeçalho segue pela matrícula, como antes. */
    const [comFilial] = await previa(rhToken, [pagina(null, "153")], { establishment_id: ag.id });
    expect([comFilial.situacao, comFilial.user_id]).toEqual(["CONFERE", pessoa.daAg]);
  });

  it("duas filiais com o mesmo código: não adivinha", async () => {
    const sombra = await prisma.establishment.create({
      data: { organizationId: orgId, name: `Sombra ${SUFIXO}`, payrollCode: "682" },
    });
    try {
      const [parte] = await previa(rhToken, [pagina("0682", "153")]);
      expect(parte.situacao).toBe("SEM_CADASTRO");
      expect(parte.motivos[0]).toContain("Mais de uma filial tem o código da folha 0682");
    } finally {
      await prisma.establishment.delete({ where: { id: sombra.id } });
    }
  });

  it("quem gere só a Loja não alcança a página da AG, e o motivo não diz o nome dela", async () => {
    const [daAg, daLoja] = await previa(admLoja, [pagina("0683", "153"), pagina("0682", "153")]);
    expect(daAg.situacao).toBe("SEM_CADASTRO");
    expect(daAg.user_id).toBeNull();
    expect(daAg.motivos).toEqual(["Esta página é de uma filial fora das que você gere."]);
    expect(daAg.motivos.join(" ")).not.toContain(ag.nome);
    expect([daLoja.situacao, daLoja.user_id]).toEqual(["CONFERE", pessoa.daLoja]);
  });

  it("publicar sem escolher filial entrega cada página à pessoa da sua empresa", async () => {
    const res = await request(app)
      .post("/api/payslips/lote")
      .set(as(rhToken))
      .send(lote(await pdfDePaginas([pagina("0682", "153"), pagina("0683", "153")])));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.publicados).toBe(2);
    const gravados = await prisma.payslip.findMany({
      where: { organizationId: orgId },
      select: { userId: true },
    });
    expect(gravados.map((g) => g.userId).sort()).toEqual([pessoa.daLoja, pessoa.daAg].sort());
    await prisma.payslipVersion.deleteMany({ where: { payslip: { organizationId: orgId } } });
    await prisma.payslip.deleteMany({ where: { organizationId: orgId } });
  });
});

describe("o envio individual confere a empresa da pessoa [C3-3]", () => {
  const enviar = async (codigo: string, userId: string, extra: Record<string, unknown> = {}) =>
    request(app)
      .post("/api/payslips")
      .set(as(rhToken))
      .send({
        user_id: userId,
        reference_month: 10,
        reference_year: 2026,
        file_name: "holerite.pdf",
        mime_type: "application/pdf",
        content_base64: (await pdfDePaginas([pagina(codigo, "153")])).toString("base64"),
        ...extra,
      });

  it("o holerite da AG para a Maria da Loja é recusado, e justificativa não cobre", async () => {
    for (const extra of [{}, { override_reason: "O escritório garantiu que é dela." }]) {
      const res = await enviar("0683", pessoa.daLoja!, extra);
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.code).toBe("PAYSLIP_DOCUMENT_MISMATCH");
      expect(res.body.reasons).toEqual([
        "O documento é da empresa código 0683, e a filial da pessoa tem o código 0682.",
      ]);
    }
    expect(await prisma.payslip.count({ where: { organizationId: orgId } })).toBe(0);
  });

  it("o holerite da Loja para a Maria da Loja entra", async () => {
    const res = await enviar("0682", pessoa.daLoja!);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await prisma.payslipVersion.deleteMany({ where: { payslip: { organizationId: orgId } } });
    await prisma.payslip.deleteMany({ where: { organizationId: orgId } });
  });
});
