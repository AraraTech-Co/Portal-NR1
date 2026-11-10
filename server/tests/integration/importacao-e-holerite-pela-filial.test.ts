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
import { pdfDePaginas, paginaDaFolha } from "../helpers/pdf";

/**
 * Importação e lote de holerite escolhem a filial. [C3-3]
 *
 * Uma empresa própria do teste com duas filiais, Loja e AG, cada uma com a
 * sua função "Vendedor". A matrícula 153 existe nas duas e é de pessoas
 * diferentes, como na folha da Americana. Uma terceira empresa, de uma filial
 * só, mostra que nada muda para quem tem uma filial.
 *
 * Apagadas no fim, com os arquivos gravados.
 */
const SUFIXO = Date.now().toString(36);
const SENHA = ["c33", "filial", "lote"].join("-");
const COMPETENCIA = "OUTUBRO/2026";

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

type Empresa = {
  orgId: string;
  contaId: string;
  usuarios: string[];
  rhToken: string;
};
type Filial = { id: string; nome: string; vendedor: string };

let app: Express;
const grupo: Empresa = { orgId: "", contaId: "", usuarios: [], rhToken: "" };
const sozinha: Empresa = { orgId: "", contaId: "", usuarios: [], rhToken: "" };
let loja: Filial;
let ag: Filial;
let arquivada: Filial;
let unicaDaSozinha: Filial;
let filialDeOutraEmpresa: string;
let admLoja = "";
/** Quem recebe holerite: nome → id. */
const pessoa: Record<string, string> = {};

async function novaEmpresa(e: Empresa, nome: string) {
  const org = await prisma.organization.create({ data: { name: `C33 ${nome} ${SUFIXO}` } });
  e.orgId = org.id;
  const conta = await prisma.account.create({
    data: { organizationId: org.id, name: `Conta C33 ${nome} ${SUFIXO}` },
  });
  e.contaId = conta.id;
}

async function novaFilial(e: Empresa, nome: string, archived = false): Promise<Filial> {
  const est = await prisma.establishment.create({
    data: {
      organizationId: e.orgId,
      name: `${nome} ${SUFIXO}`,
      archivedAt: archived ? new Date() : null,
    },
  });
  const setor = await prisma.sector.create({
    data: { organizationId: e.orgId, establishmentId: est.id, name: `Vendas ${nome}` },
  });
  const funcao = await prisma.jobRole.create({
    data: { organizationId: e.orgId, sectorId: setor.id, name: "Vendedor" },
  });
  return { id: est.id, nome: est.name, vendedor: funcao.id };
}

async function novaPessoa(
  e: Empresa,
  nome: string,
  role: Role,
  ficha?: { matricula: string; filial: string | null },
) {
  const login = `c33.${nome.split(" ")[0]}.${e.orgId.slice(0, 4)}.${SUFIXO}`.toLowerCase();
  const user = await prisma.user.create({
    data: { login, name: nome, passwordHash: await bcrypt.hash(SENHA, 4) },
  });
  e.usuarios.push(user.id);
  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId: e.orgId, role },
  });
  await prisma.accountMembership.create({
    data: { accountId: e.contaId, userId: user.id, role: AccountRole.USER },
  });
  if (ficha) {
    await prisma.employeeProfile.create({
      data: {
        organizationId: e.orgId,
        userId: user.id,
        registration: ficha.matricula,
        establishmentId: ficha.filial,
      },
    });
  }
  return { id: user.id, login, membershipId: membership.id };
}

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.token as string;
}

const importar = (token: string, people: Record<string, unknown>[], dry_run: boolean) =>
  request(app).post("/api/pessoas-acessos/importar").set(as(token)).send({ people, dry_run });

const lote = (pdf: Buffer, extra: Record<string, unknown> = {}) => ({
  reference_month: 10,
  reference_year: 2026,
  file_name: "folha-outubro.pdf",
  mime_type: "application/pdf",
  content_base64: pdf.toString("base64"),
  ...extra,
});

type Parte = {
  registration: string | null;
  situacao: string;
  user_id: string | null;
  motivos: string[];
};

beforeAll(async () => {
  app = createApp();

  await novaEmpresa(grupo, "Grupo");
  loja = await novaFilial(grupo, "Loja");
  ag = await novaFilial(grupo, "AG");
  arquivada = await novaFilial(grupo, "Fechada", true);
  const rh = await novaPessoa(grupo, "Rita do RH", Role.RH);
  grupo.rhToken = await entrar(rh.login);

  /* A mesma matrícula nas duas filiais, de pessoas diferentes. */
  pessoa["Ana Loja"] = (await novaPessoa(grupo, "Ana Loja", Role.COLABORADOR, { matricula: "153", filial: loja.id })).id;
  pessoa["Bruno AG"] = (await novaPessoa(grupo, "Bruno AG", Role.COLABORADOR, { matricula: "000153", filial: ag.id })).id;
  pessoa["Carla Loja"] = (await novaPessoa(grupo, "Carla Loja", Role.COLABORADOR, { matricula: "200", filial: loja.id })).id;
  /* Ficha antiga, ainda sem filial: o RH completa pela lista. */
  pessoa["Davi Sem"] = (await novaPessoa(grupo, "Davi Sem", Role.COLABORADOR, { matricula: "300", filial: null })).id;

  /* ADM loja que responde só pela Loja. */
  const adm = await novaPessoa(grupo, "Otto Adm", Role.ADM_LOJA);
  await prisma.managedEstablishment.create({
    data: {
      organizationId: grupo.orgId,
      membershipId: adm.membershipId,
      establishmentId: loja.id,
      createdById: rh.id,
    },
  });
  admLoja = await entrar(adm.login);

  await novaEmpresa(sozinha, "Sozinha");
  unicaDaSozinha = await novaFilial(sozinha, "Unica");
  const rhSozinha = await novaPessoa(sozinha, "Rosa do RH", Role.RH);
  sozinha.rhToken = await entrar(rhSozinha.login);
  pessoa["Eva Unica"] = (await novaPessoa(sozinha, "Eva Unica", Role.COLABORADOR, { matricula: "153", filial: unicaDaSozinha.id })).id;
  filialDeOutraEmpresa = unicaDaSozinha.id;
});

afterAll(async () => {
  for (const e of [grupo, sozinha]) {
    if (!e.orgId) continue;
    const membros = await prisma.membership.findMany({
      where: { organizationId: e.orgId },
      select: { userId: true },
    });
    const ids = [...new Set([...e.usuarios, ...membros.map((m) => m.userId)])];
    await prisma.notification.deleteMany({ where: { organizationId: e.orgId } });
    await prisma.auditEvent.deleteMany({ where: { organizationId: e.orgId } });
    await prisma.payslipVersion.deleteMany({ where: { payslip: { organizationId: e.orgId } } });
    await prisma.payslip.deleteMany({ where: { organizationId: e.orgId } });
    await prisma.employeeProfile.deleteMany({ where: { organizationId: e.orgId } });
    await prisma.managedEstablishment.deleteMany({ where: { organizationId: e.orgId } });
    await prisma.accountMembership.deleteMany({ where: { accountId: e.contaId } });
    await prisma.membership.deleteMany({ where: { organizationId: e.orgId } });
    await prisma.token.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.jobRole.deleteMany({ where: { organizationId: e.orgId } });
    await prisma.sector.deleteMany({ where: { organizationId: e.orgId } });
    await prisma.establishment.deleteMany({ where: { organizationId: e.orgId } });
    await prisma.account.deleteMany({ where: { id: e.contaId } });
    await prisma.organization.deleteMany({ where: { id: e.orgId } });
    rmSync(join(uploadsRoot(), e.orgId), { recursive: true, force: true });
  }
});

describe("a planilha escolhe a filial [C3-3]", () => {
  it("com mais de uma filial, a linha sem filial e sem função volta com o motivo", async () => {
    const res = await importar(
      grupo.rhToken,
      [{ name: "Fabio Sem Filial", registration: "401" }],
      true,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.results[0]).toMatchObject({ status: "error", establishment: null });
    expect(res.body.results[0].message).toContain("filial");
  });

  it("a função já diz a filial: a linha com a função e sem a coluna cai na filial dela", async () => {
    const res = await importar(
      grupo.rhToken,
      [{ name: "Fabio Com Funcao", registration: "401", job_role_id: ag.vendedor }],
      true,
    );
    expect(res.body.results[0]).toMatchObject({ status: "created" });
    expect(res.body.results[0].establishment).toEqual({ id: ag.id, name: ag.nome });
  });

  it("a prévia mostra a filial resolvida em cada linha", async () => {
    const res = await importar(
      grupo.rhToken,
      [
        { name: "Gil Loja", registration: "402", establishment_id: loja.id, job_role_id: loja.vendedor },
        { name: "Hugo AG", registration: "402", establishment_id: ag.id },
      ],
      true,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual(["created", "created"]);
    expect(res.body.results[0].establishment).toEqual({ id: loja.id, name: loja.nome });
    expect(res.body.results[1].establishment).toEqual({ id: ag.id, name: ag.nome });
  });

  it("a mesma matrícula entra nas duas filiais, uma ficha em cada", async () => {
    const res = await importar(
      grupo.rhToken,
      [
        { name: "Ivo Loja", registration: "0403", establishment_id: loja.id, job_role_id: loja.vendedor },
        { name: "Jair AG", registration: "403", establishment_id: ag.id, job_role_id: ag.vendedor },
      ],
      false,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.created).toBe(2);
    const fichas = await prisma.employeeProfile.findMany({
      where: { organizationId: grupo.orgId, registrationKey: "403" },
      select: { establishmentId: true, user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    });
    expect(fichas.map((f) => [f.user.name, f.establishmentId])).toEqual([
      ["Ivo Loja", loja.id],
      ["Jair AG", ag.id],
    ]);
  });

  it("a função de outra filial é recusada na linha", async () => {
    const res = await importar(
      grupo.rhToken,
      [{ name: "Kátia Troca", establishment_id: ag.id, job_role_id: loja.vendedor }],
      true,
    );
    expect(res.body.results[0]).toMatchObject({ status: "error" });
    expect(res.body.results[0].message).toContain("outra filial");
  });

  it("a filial arquivada ou de outra empresa é recusada", async () => {
    for (const id of [arquivada.id, filialDeOutraEmpresa]) {
      const res = await importar(grupo.rhToken, [{ name: "Leo Fora", establishment_id: id }], true);
      expect(res.body.results[0], id).toMatchObject({ status: "error" });
    }
  });

  it("com uma filial só, a linha sem filial entra nela, como antes", async () => {
    const res = await importar(sozinha.rhToken, [{ name: "Mara Unica", registration: "404" }], true);
    expect(res.body.results[0]).toMatchObject({ status: "created" });
    expect(res.body.results[0].establishment).toEqual({
      id: unicaDaSozinha.id,
      name: unicaDaSozinha.nome,
    });
  });
});

describe("o lote de holerite escolhe a filial [C3-3]", () => {
  let folha: Buffer;

  beforeAll(async () => {
    folha = await pdfDePaginas([
      paginaDaFolha("000153", "ANA LOJA", COMPETENCIA),
      paginaDaFolha("000200", "CARLA LOJA", COMPETENCIA),
    ]);
  });

  it("a tela lista as filiais de quem envia e diz se a escolha é obrigatória", async () => {
    const central = await request(app).get("/api/payslips/lote/filiais").set(as(grupo.rhToken));
    expect(central.status, JSON.stringify(central.body)).toBe(200);
    expect(central.body.obrigatoria).toBe(true);
    expect(central.body.filiais.map((f: { id: string }) => f.id).sort()).toEqual(
      [loja.id, ag.id].sort(),
    );
    expect(Object.keys(central.body.filiais[0]).sort()).toEqual(["id", "name"]);

    const recortado = await request(app).get("/api/payslips/lote/filiais").set(as(admLoja));
    expect(recortado.status).toBe(200);
    expect(recortado.body.filiais.map((f: { id: string }) => f.id)).toEqual([loja.id]);

    const unica = await request(app).get("/api/payslips/lote/filiais").set(as(sozinha.rhToken));
    expect(unica.body.obrigatoria).toBe(false);
  });

  it("com mais de uma filial, o lote sem filial é recusado antes de ler", async () => {
    const res = await request(app)
      .post("/api/payslips/lote/previa")
      .set(as(grupo.rhToken))
      .send(lote(folha));
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("filial");
  });

  it("a matrícula 153 da Loja é da Ana, não do Bruno da AG", async () => {
    const res = await request(app)
      .post("/api/payslips/lote/previa")
      .set(as(grupo.rhToken))
      .send(lote(folha, { establishment_id: loja.id }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const partes = res.body.parts as Parte[];
    expect(partes.map((p) => [p.situacao, p.user_id])).toEqual([
      ["CONFERE", pessoa["Ana Loja"]],
      ["CONFERE", pessoa["Carla Loja"]],
    ]);
  });

  it("a mesma página na AG casa com o Bruno, e a Carla não está lá", async () => {
    const pdf = await pdfDePaginas([
      paginaDaFolha("000153", "BRUNO AG", COMPETENCIA),
      paginaDaFolha("000200", "CARLA LOJA", COMPETENCIA),
    ]);
    const res = await request(app)
      .post("/api/payslips/lote/previa")
      .set(as(grupo.rhToken))
      .send(lote(pdf, { establishment_id: ag.id }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [bruno, carla] = res.body.parts as Parte[];
    expect([bruno.situacao, bruno.user_id]).toEqual(["CONFERE", pessoa["Bruno AG"]]);
    expect(carla.situacao).toBe("SEM_CADASTRO");
    expect(carla.motivos.join(" ")).toContain(ag.nome);
  });

  it("a ficha sem filial não recebe, e o motivo diz o que completar", async () => {
    const pdf = await pdfDePaginas([paginaDaFolha("000300", "DAVI SEM", COMPETENCIA)]);
    const res = await request(app)
      .post("/api/payslips/lote/previa")
      .set(as(grupo.rhToken))
      .send(lote(pdf, { establishment_id: loja.id }));
    const [davi] = res.body.parts as Parte[];
    expect(davi.situacao).toBe("SEM_CADASTRO");
    expect(davi.user_id).toBeNull();
    expect(davi.motivos.join(" ")).toContain("sem filial");
  });

  it("filial arquivada, de outra empresa ou inexistente é recusada", async () => {
    for (const id of [arquivada.id, filialDeOutraEmpresa, "00000000-0000-4000-8000-000000000000"]) {
      const res = await request(app)
        .post("/api/payslips/lote/previa")
        .set(as(grupo.rhToken))
        .send(lote(folha, { establishment_id: id }));
      expect(res.status, id).toBe(400);
    }
  });

  it("o ADM loja não envia a folha de uma filial que não é dele", async () => {
    for (const rota of ["/api/payslips/lote/previa", "/api/payslips/lote"]) {
      const fora = await request(app)
        .post(rota)
        .set(as(admLoja))
        .send(lote(folha, { establishment_id: ag.id }));
      expect(fora.status, rota).toBe(400);
    }
    const dele = await request(app)
      .post("/api/payslips/lote/previa")
      .set(as(admLoja))
      .send(lote(folha, { establishment_id: loja.id }));
    expect(dele.status).toBe(200);
    expect((dele.body.parts as Parte[]).every((p) => p.situacao === "CONFERE")).toBe(true);
  });

  it("publicar pela Loja entrega à Ana e à Carla, e o Bruno fica sem nada", async () => {
    const res = await request(app)
      .post("/api/payslips/lote")
      .set(as(grupo.rhToken))
      .send(lote(folha, { establishment_id: loja.id }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.publicados).toBe(2);
    const donos = await prisma.payslip.findMany({
      where: { organizationId: grupo.orgId },
      select: { userId: true },
    });
    expect(donos.map((d) => d.userId).sort()).toEqual(
      [pessoa["Ana Loja"], pessoa["Carla Loja"]].sort(),
    );
  });

  it("com uma filial só, o lote sem filial segue como antes", async () => {
    const pdf = await pdfDePaginas([paginaDaFolha("000153", "EVA UNICA", COMPETENCIA)]);
    const res = await request(app)
      .post("/api/payslips/lote/previa")
      .set(as(sozinha.rhToken))
      .send(lote(pdf));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [eva] = res.body.parts as Parte[];
    expect([eva.situacao, eva.user_id]).toEqual(["CONFERE", pessoa["Eva Unica"]]);
  });
});
