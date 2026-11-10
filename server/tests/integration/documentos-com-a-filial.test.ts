import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Razão social e CNPJ da filial nos documentos. [C3-4]
 *
 * Cada filial da Americana é um CNPJ: o PGR de uma filial, a ordem de serviço
 * de uma função e o painel da fiscalização filtrado por filial saem com a
 * razão social e o CNPJ dela. Sem filial ou sem razão social, sai a empresa,
 * como antes. Documento já emitido não muda: o que saiu no papel fica.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

/** CNPJ válido e inédito a cada execução. */
function cnpjFicticio(semente: number): string {
  const base = String(10_000_000 + (semente % 89_999_999)).padStart(8, "0") + "0001";
  const digitos = base.split("").map(Number);
  const dv = (pesos: number[]) => {
    const soma = digitos.reduce((t, d, i) => t + d * pesos[i]!, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  digitos.push(dv([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  digitos.push(dv([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  return digitos.join("");
}

type Empregador = { name: string; taxId: string | null };

let app: Express;
let sst: string;
let owner: string;
let empresa: Empregador;

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body.token as string;
}

/** Uma filial com uma função que tem perigo e risco avaliado: dá para emitir tudo. */
async function filialComRisco(nome: string, cnpj: string | null) {
  const est = (
    await request(app)
      .post("/api/establishments")
      .set(as(sst))
      .send({ name: `${nome} ${SUFIXO}`, ...(cnpj ? { tax_id: cnpj } : {}) })
  ).body.establishment;
  const sector = (
    await request(app).post("/api/sectors").set(as(sst)).send({ establishment_id: est.id, name: "Vendas" })
  ).body.sector;
  const role = (
    await request(app)
      .post("/api/job-roles")
      .set(as(sst))
      .send({ sector_id: sector.id, name: `Vendedor ${nome}`, description: "Atende" })
  ).body.job_role;
  const activity = (
    await request(app).post("/api/activities").set(as(sst)).send({
      establishment_id: est.id,
      sector_id: sector.id,
      name: `Repor gôndola ${nome}`,
      description: "Sobe e desce caixas",
      job_role_ids: [role.id],
    })
  ).body.activity;
  const hazard = (
    await request(app).post("/api/hazards").set(as(sst)).send({
      activity_id: activity.id,
      description: `Carga manual ${nome}`,
      category: "ERGONOMIC",
      source: "Caixas de 20 kg",
      consequences: "Lombalgia",
    })
  ).body.hazard;
  const risk = (
    await request(app).post("/api/risks").set(as(sst)).send({ hazard_id: hazard.id, description: `Coluna ${nome}` })
  ).body.risk;
  const metodologias = (await request(app).get("/api/methodologies").set(as(sst))).body
    .methodologies as { isDefault: boolean; versions: { id: string }[] }[];
  const versao = (metodologias.find((m) => m.isDefault) ?? metodologias[0]!).versions[0]!.id;
  const avaliacao = (
    await request(app).post("/api/assessments").set(as(sst)).send({
      risk_id: risk.id,
      methodology_version_id: versao,
      severity: 3,
      probability: 3,
    })
  ).body.assessment;
  await request(app).post(`/api/assessments/${avaliacao.id}/validate`).set(as(owner));
  return { id: est.id as string, roleId: role.id as string, nome: est.name as string };
}

const editarFilial = (id: string, body: Record<string, unknown>) =>
  request(app).patch(`/api/establishments/${id}`).set(as(sst)).send(body);

/* Status conferido aqui: um 407 do proxy local aparece como 407, não como TypeError. */
const emitirPgr = async (establishment_id: string | null) => {
  const res = await request(app)
    .post("/api/pgr-documents")
    .set(as(sst))
    .send({ type: "INVENTORY", establishment_id, responsible_name: "Eng. Filial" });
  expect(res.status, `emitir o PGR: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(201);
  return res;
};

const lerPgr = async (id: string) =>
  (await request(app).get(`/api/pgr-documents/${id}`).set(as(sst))).body.document;

const emitirOrdem = (roleId: string) =>
  request(app).post("/api/service-orders").set(as(sst)).send({
    job_role_id: roleId,
    duties: "Usar o carrinho. Avisar o gerente de qualquer dor.",
  });

const lerOrdem = async (id: string) =>
  (await request(app).get(`/api/service-orders/${id}`).set(as(sst))).body.service_order;

beforeAll(async () => {
  app = createApp();
  sst = await entrar("teste.sst");
  owner = await entrar("teste.owner");
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: ORG_ID },
    select: { name: true, taxId: true },
  });
  empresa = { name: org.name, taxId: org.taxId };
});

describe("a filial guarda razão social e código da folha [C3-4]", () => {
  it("grava e devolve, e limpar a razão social volta a valer a empresa", async () => {
    const f = await filialComRisco("Grava", cnpjFicticio(Date.now()));
    const salvo = await editarFilial(f.id, { legal_name: "  Utilidade Americana Loja Ltda  ", payroll_code: "0682" });
    expect(salvo.status, JSON.stringify(salvo.body)).toBe(200);
    expect(salvo.body.establishment).toMatchObject({
      legalName: "Utilidade Americana Loja Ltda",
      payrollCode: "0682",
    });
    const limpo = await editarFilial(f.id, { legal_name: null, payroll_code: "" });
    expect(limpo.status).toBe(200);
    expect(limpo.body.establishment).toMatchObject({ legalName: null, payrollCode: null });
  });

  it("razão social sem CNPJ na filial é recusada: a razão de um não sai com o CNPJ de outro", async () => {
    const f = await filialComRisco("SemCnpj", null);
    const res = await editarFilial(f.id, { legal_name: "Filial Sem Cnpj Ltda" });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("CNPJ");
    const tirarCnpj = await editarFilial(
      (await filialComRisco("TiraCnpj", cnpjFicticio(Date.now() + 7))).id,
      { legal_name: "Tira Cnpj Ltda", tax_id: null },
    );
    expect(tirarCnpj.status, "tirar o CNPJ e pôr a razão juntos também não").toBe(400);
  });

  it("código da folha fora do padrão é recusado", async () => {
    const f = await filialComRisco("Codigo", cnpjFicticio(Date.now() + 3));
    for (const payroll_code of ["06 82", "x".repeat(21), "06/82"]) {
      const res = await editarFilial(f.id, { payroll_code });
      expect(res.status, payroll_code).toBe(400);
    }
  });
});

describe("o PGR sai com a filial [C3-4]", () => {
  it("da filial com razão social: a razão e o CNPJ dela; de todos os estabelecimentos: a empresa", async () => {
    const cnpj = cnpjFicticio(Date.now() + 11);
    const f = await filialComRisco("Pgr", cnpj);
    await editarFilial(f.id, { legal_name: "Americana Pgr Ltda" });

    const daFilial = await emitirPgr(f.id);
    expect(daFilial.status, JSON.stringify(daFilial.body)).toBe(201);
    expect((await lerPgr(daFilial.body.document.id)).employer).toEqual({
      name: "Americana Pgr Ltda",
      taxId: cnpj,
    });

    const geral = await emitirPgr(null);
    expect(geral.status, JSON.stringify(geral.body)).toBe(201);
    expect((await lerPgr(geral.body.document.id)).employer).toEqual(empresa);
  });

  it("filial sem razão social: a empresa, como antes", async () => {
    const f = await filialComRisco("PgrSem", cnpjFicticio(Date.now() + 13));
    const doc = await emitirPgr(f.id);
    expect((await lerPgr(doc.body.document.id)).employer).toEqual(empresa);
  });

  it("o já emitido não muda; a versão nova sai com a filial", async () => {
    const cnpj = cnpjFicticio(Date.now() + 17);
    const f = await filialComRisco("PgrAntes", cnpj);
    const v1 = (await emitirPgr(f.id)).body.document.id as string;
    await editarFilial(f.id, { legal_name: "Americana Depois Ltda" });
    expect((await lerPgr(v1)).employer, "a v1 saiu com a empresa").toEqual(empresa);
    const v2 = (await emitirPgr(f.id)).body.document.id as string;
    expect((await lerPgr(v2)).employer).toEqual({ name: "Americana Depois Ltda", taxId: cnpj });
  });

  it("documento de antes desta versão, sem o retrato, mostra a empresa", async () => {
    const f = await filialComRisco("PgrVelho", cnpjFicticio(Date.now() + 19));
    await editarFilial(f.id, { legal_name: "Americana Velho Ltda" });
    const id = (await emitirPgr(f.id)).body.document.id as string;
    await prisma.pgrDocument.update({ where: { id }, data: { employerName: null, employerTaxId: null } });
    expect((await lerPgr(id)).employer).toEqual(empresa);
  });
});

describe("a ordem de serviço sai com a filial da função [C3-4]", () => {
  it("razão e CNPJ da filial; emitida antes da razão, continua com a empresa", async () => {
    const cnpj = cnpjFicticio(Date.now() + 23);
    const f = await filialComRisco("Ordem", cnpj);
    const antes = await emitirOrdem(f.roleId);
    expect(antes.status, JSON.stringify(antes.body)).toBe(201);
    await editarFilial(f.id, { legal_name: "Americana Ordem Ltda" });
    const depois = await emitirOrdem(f.roleId);
    expect((await lerOrdem(antes.body.service_order.id)).employer).toEqual(empresa);
    expect((await lerOrdem(depois.body.service_order.id)).employer).toEqual({
      name: "Americana Ordem Ltda",
      taxId: cnpj,
    });
  });
});

describe("o painel da fiscalização filtrado pela filial [C3-4]", () => {
  it("com a filial filtrada, ela; sem filtro ou sem razão, a empresa", async () => {
    const cnpj = cnpjFicticio(Date.now() + 29);
    const f = await filialComRisco("Painel", cnpj);
    const semRazao = await filialComRisco("PainelSem", cnpjFicticio(Date.now() + 31));
    await editarFilial(f.id, { legal_name: "Americana Painel Ltda" });

    const filtrado = await request(app).get(`/api/fiscalizacao?establishment_id=${f.id}`).set(as(owner));
    expect(filtrado.status, JSON.stringify(filtrado.body).slice(0, 200)).toBe(200);
    expect(filtrado.body.employer).toEqual({ name: "Americana Painel Ltda", taxId: cnpj });

    const todos = await request(app).get("/api/fiscalizacao").set(as(owner));
    expect(todos.body.employer).toEqual(empresa);

    const outra = await request(app)
      .get(`/api/fiscalizacao?establishment_id=${semRazao.id}`)
      .set(as(owner));
    expect(outra.body.employer).toEqual(empresa);
  });

  it("a filial de outra empresa no filtro não empresta a razão dela", async () => {
    const alheia = await prisma.organization.create({ data: { name: `C34 Alheia ${SUFIXO}` } });
    try {
      const dela = await prisma.establishment.create({
        data: {
          organizationId: alheia.id,
          name: `Alheia ${SUFIXO}`,
          legalName: "Outra Empresa Ltda",
          taxId: cnpjFicticio(Date.now() + 37),
        },
      });
      const res = await request(app).get(`/api/fiscalizacao?establishment_id=${dela.id}`).set(as(owner));
      expect(res.body.employer, JSON.stringify(res.body).slice(0, 200)).toEqual(empresa);
    } finally {
      await prisma.establishment.deleteMany({ where: { organizationId: alheia.id } });
      await prisma.organization.delete({ where: { id: alheia.id } });
    }
  });
});
