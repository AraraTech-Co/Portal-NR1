import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O Responsável pelo PGR de Configurações vem sugerido na emissão.
 *
 * A tela exigia escolher uma pessoa e tirava o cargo da função dela: o
 * responsável cadastrado em Configurações nunca era usado, e o cargo vinha
 * em branco para quem não tem função. E, com outra pessoa escolhida, o
 * servidor completava o documento com o cargo do responsável da empresa.
 * [CB-57]
 *
 * Usa o responsável que a organização de teste já tem, sem mudá-lo: outros
 * arquivos emitem documentos nela ao mesmo tempo.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SUFIXO = Date.now().toString(36);
const PAGINAS = join(__dirname, "..", "..", "..", "client", "src", "pages");

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let sst: string;
let admin: string;
let empresa: { responsibleName: string | null; responsibleRole: string | null; responsibleRegistration: string | null };
const emitidos: string[] = [];

async function entrar(login: string, senha: string) {
  const res = await request(app).post("/api/auth").send({ login, password: senha });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body.token as string;
}

async function emitir(corpo: Record<string, unknown>) {
  const res = await request(app)
    .post("/api/pgr-documents")
    .set(as(sst))
    .send({ type: "ACTION_PLAN", ...corpo });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  emitidos.push(res.body.document.id);
  return prisma.pgrDocument.findUniqueOrThrow({
    where: { id: res.body.document.id },
    select: { responsibleName: true, responsibleRole: true, responsibleRegistration: true },
  });
}

beforeAll(async () => {
  app = createApp();
  sst = await entrar("teste.sst", "teste1234");
  admin = await entrar("admin", "admin123");
  empresa = await prisma.organization.findUniqueOrThrow({
    where: { id: ORG_ID },
    select: { responsibleName: true, responsibleRole: true, responsibleRegistration: true },
  });
  expect(empresa.responsibleName, "a organização de teste tem responsável").toBeTruthy();
  expect(empresa.responsibleRole, "e cargo").toBeTruthy();
}, 30_000);

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: emitidos } } });
  await prisma.pgrDocument.deleteMany({ where: { id: { in: emitidos } } });
  if (propria.orgId) {
    await prisma.auditEvent.deleteMany({ where: { organizationId: propria.orgId } });
    await prisma.pgrDocument.deleteMany({ where: { organizationId: propria.orgId } });
    await prisma.notification.deleteMany({ where: { organizationId: propria.orgId } });
    await prisma.action.deleteMany({ where: { organizationId: propria.orgId } });
    await prisma.user.deleteMany({ where: { id: propria.userId } });
    await prisma.organization.deleteMany({ where: { id: propria.orgId } });
  }
});

/*
  A organização de teste não tem registro profissional no responsável: para
  provar que o registro também não passa para outra pessoa, uma organização
  própria, com registro, que nenhum outro arquivo usa.
*/
const propria = { orgId: "", userId: "", token: "" };
const REGISTRO = `MTE ${SUFIXO}`;
async function organizacaoPropria() {
  if (propria.token) return propria;
  const org = await prisma.organization.create({
    data: {
      name: `Registro ${SUFIXO}`,
      responsibleName: `Responsável ${SUFIXO}`,
      responsibleRole: "Técnico SST",
      responsibleRegistration: REGISTRO,
    },
  });
  const login = `sst.registro.${SUFIXO}`;
  const user = await prisma.user.create({
    data: { login, email: `${login}@teste.local`, name: `SST ${SUFIXO}`, passwordHash: await bcrypt.hash("teste1234", 4) },
  });
  await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role: Role.SST } });
  const conta = await prisma.account.create({ data: { organizationId: org.id, name: `Conta ${SUFIXO}` } });
  await prisma.accountMembership.create({
    data: { accountId: conta.id, userId: user.id, role: AccountRole.ADMIN },
  });
  Object.assign(propria, { orgId: org.id, userId: user.id, token: await entrar(login, "teste1234") });
  /* O plano de ação não se emite vazio. */
  const acao = await request(app)
    .post("/api/actions")
    .set(as(propria.token))
    .send({
      title: `Ação ${SUFIXO}`,
      assignee_id: user.id,
      due_date: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10),
      effectiveness_criteria: "Critério do teste",
    });
  expect(acao.status, JSON.stringify(acao.body)).toBe(201);
  return propria;
}

describe("a emissão sabe quem é o responsável da empresa [CB-57]", () => {
  it("a lista de documentos traz o responsável de Configurações", async () => {
    const res = await request(app).get("/api/pgr-documents").set(as(sst));
    expect(res.status).toBe(200);
    expect(res.body.default_responsible).toEqual({
      name: empresa.responsibleName,
      role: empresa.responsibleRole,
      registration: empresa.responsibleRegistration,
    });
  });

  it("empresa sem responsável cadastrado: nada sugerido", async () => {
    const res = await request(app).get("/api/pgr-documents").set(as(admin));
    expect(res.status).toBe(200);
    expect(res.body.default_responsible).toBeNull();
  });

  it("emitido pelo responsável da empresa, o cargo cadastrado vai junto", async () => {
    const doc = await emitir({ responsible_name: empresa.responsibleName });
    expect(doc.responsibleName).toBe(empresa.responsibleName);
    expect(doc.responsibleRole).toBe(empresa.responsibleRole);
  }, 30_000);

  it("com outra pessoa, o cargo do responsável da empresa não vai parar ao lado do nome dela", async () => {
    const doc = await emitir({ responsible_name: `Outra Pessoa ${SUFIXO}` });
    expect(doc.responsibleName).toBe(`Outra Pessoa ${SUFIXO}`);
    expect(doc.responsibleRole).toBeNull();
    expect(doc.responsibleRegistration).toBeNull();
  }, 30_000);

  it("nem o registro profissional do responsável da empresa", async () => {
    const { token } = await organizacaoPropria();
    const emitir = (nome: string) =>
      request(app).post("/api/pgr-documents").set(as(token)).send({ type: "ACTION_PLAN", responsible_name: nome });

    const dele = await emitir(`Responsável ${SUFIXO}`);
    expect(dele.status, JSON.stringify(dele.body)).toBe(201);
    expect(dele.body.document.responsibleRegistration).toBe(REGISTRO);

    const outra = await emitir(`Outra Pessoa ${SUFIXO}`);
    expect(outra.status, JSON.stringify(outra.body)).toBe(201);
    expect(outra.body.document.responsibleRegistration).toBeNull();
    expect(outra.body.document.responsibleRole).toBeNull();
  }, 30_000);

  it("o cargo digitado por quem emite vale, mesmo para o responsável da empresa", async () => {
    const doc = await emitir({
      responsible_name: empresa.responsibleName,
      responsible_role: `Engenheiro ${SUFIXO}`,
      responsible_registration: "CREA-SP 1234567",
    });
    expect(doc.responsibleRole).toBe(`Engenheiro ${SUFIXO}`);
    expect(doc.responsibleRegistration).toBe("CREA-SP 1234567");
  }, 30_000);
});

describe("a tela de emissão [CB-57]", () => {
  const tela = readFileSync(join(PAGINAS, "DocumentsPage.tsx"), "utf8").replace(/\s+/g, " ");

  it("o responsável da empresa vem escolhido ao abrir e depois de emitir", () => {
    expect(tela).toContain("setPadrao(docs.default_responsible);");
    expect(tela).toMatch(/\.then\(\(r\) => \{ if \(!cancelled && r\) usarOResponsavelDaEmpresa\(r\); \}\)/);
    expect(tela).toMatch(/const r = await reload\(\); if \(r\) usarOResponsavelDaEmpresa\(r\); else escolherOutraPessoa\(\);/);
  });

  it("escolher o responsável da empresa preenche nome, cargo e registro", () => {
    expect(tela).toMatch(
      /function usarOResponsavelDaEmpresa\(r: ResponsavelDaEmpresa\) \{ setQuem\("empresa"\); setResponsibleUserId\(""\); setResponsibleName\(r\.name\); setResponsibleRole\(r\.role \?\? ""\); setResponsibleRegistration\(r\.registration \?\? ""\); \}/,
    );
  });

  it("outra pessoa é escolha, e a lista de pessoas só aparece nela", () => {
    expect(tela).toContain("— Responsável pelo PGR em Configurações");
    expect(tela).toContain('{(!padrao || quem === "outra") && (');
    expect(tela).toMatch(/if \(!responsibleName\.trim\(\)\) \{ setFormError\("Selecione o responsável\."\);/);
  });

  it("trocar de pessoa troca o cargo, mesmo quando a nova não tem função", () => {
    expect(tela).toContain('setResponsibleRole(member?.jobRoleName ?? "");');
  });
});
