import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { AccountRole, NotificationKind, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { resolveStoragePath, uploadsRoot } from "../../src/helper/uploads";
import { extractPdfPages } from "../../src/helper/pdf-text";
import { extractEmployeeEntries } from "../../src/helper/payslip-check";
import { pdfDePaginas, paginaDaFolha } from "../helpers/pdf";

/**
 * A folha do mês num arquivo só. [B4-F]
 *
 * O RH envia o PDF da folha com todos; o portal separa as páginas pela
 * matrícula, confere cada parte como no envio individual, mostra a prévia e
 * publica só o que confere. Cada pessoa recebe só as próprias páginas.
 *
 * O arquivo de exemplo é fictício, no layout da loja: Marcos (10), Carlos (19),
 * José (20, em duas folhas), Paulo (21), Eduardo (22), Fábio (99, sem
 * cadastro), Wagner (25) e Thiago (18, competência setembro). Esperado ao
 * publicar outubro/2026: seis publicados, dois de fora.
 *
 * Tudo numa empresa própria do teste, para que nenhuma matrícula de outro
 * arquivo entre na conta. Apagada no fim, com os arquivos gravados.
 */
const SUFIXO = Date.now().toString(36);
const SENHA = "s".repeat(4) + "-" + "9".repeat(4);
const FIXTURES = join(__dirname, "..", "fixtures", "holerites");
const LOTE = readFileSync(join(FIXTURES, "lote-mensal-outubro-2026.pdf"));

const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const corpo = (pdf: Buffer, extra: Record<string, unknown> = {}) => ({
  reference_month: 10,
  reference_year: 2026,
  file_name: "folha-outubro.pdf",
  mime_type: "application/pdf",
  content_base64: pdf.toString("base64"),
  ...extra,
});

let app: Express;
const empresa = { orgId: "", contaId: "", rhToken: "", usuarios: [] as string[] };
/** Pessoa do arquivo → id no cadastro. */
const pessoa: Record<string, string> = {};

async function criarPessoa(nome: string, matricula: string, role: Role, admissao?: string) {
  const login = `lote.${matricula}.${SUFIXO}`.toLowerCase();
  const user = await prisma.user.create({
    data: {
      login,
      email: `${login}@teste.local`,
      name: nome,
      passwordHash: await bcrypt.hash(SENHA, 4),
    },
  });
  empresa.usuarios.push(user.id);
  await prisma.membership.create({
    data: { userId: user.id, organizationId: empresa.orgId, role },
  });
  await prisma.accountMembership.create({
    data: { accountId: empresa.contaId, userId: user.id, role: AccountRole.USER },
  });
  await prisma.employeeProfile.create({
    data: {
      organizationId: empresa.orgId,
      userId: user.id,
      registration: matricula,
      admittedAt: admissao ? new Date(admissao) : null,
    },
  });
  return { id: user.id, login };
}

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body.token as string;
}

beforeAll(async () => {
  app = createApp();
  const org = await prisma.organization.create({ data: { name: `Folha ${SUFIXO}` } });
  empresa.orgId = org.id;
  const conta = await prisma.account.create({
    data: { organizationId: org.id, name: `Conta ${SUFIXO}` },
  });
  empresa.contaId = conta.id;

  const rh = await criarPessoa("Rita do RH", `RH${SUFIXO}`, Role.RH);
  empresa.rhToken = await entrar(rh.login);

  /* Cadastro com e sem zero à esquerda: a folha imprime "000010". */
  for (const [nome, matricula, admissao] of [
    ["Marcos Oliveira", "10", "2015-03-02"],
    ["Carlos Pereira", "000019", undefined],
    ["José Antunes", "20", "2018-08-15"],
    ["Paulo Ribeiro", "21", undefined],
    ["Eduardo Nunes", "22", undefined],
    ["Wagner Dias", "25", undefined],
    ["Thiago Souza", "18", undefined],
  ] as const) {
    pessoa[nome] = (await criarPessoa(nome, matricula, Role.COLABORADOR, admissao)).id;
  }
});

afterAll(async () => {
  if (!empresa.orgId) return;
  await prisma.notification.deleteMany({ where: { organizationId: empresa.orgId } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: empresa.orgId } });
  await prisma.payslipVersion.deleteMany({
    where: { payslip: { organizationId: empresa.orgId } },
  });
  await prisma.payslip.deleteMany({ where: { organizationId: empresa.orgId } });
  await prisma.employeeProfile.deleteMany({ where: { organizationId: empresa.orgId } });
  await prisma.accountMembership.deleteMany({ where: { accountId: empresa.contaId } });
  await prisma.membership.deleteMany({ where: { organizationId: empresa.orgId } });
  await prisma.token.deleteMany({ where: { userId: { in: empresa.usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: empresa.usuarios } } });
  await prisma.account.deleteMany({ where: { id: empresa.contaId } });
  await prisma.organization.deleteMany({ where: { id: empresa.orgId } });
  rmSync(join(uploadsRoot(), empresa.orgId), { recursive: true, force: true });
});

type Parte = {
  pages: number[];
  registration: string | null;
  situacao: string;
  user_id: string | null;
  substitui: boolean;
  motivos: string[];
};

describe("a prévia da folha [B4-F]", () => {
  it("seis conferem, Fábio fica sem cadastro e Thiago fica pela competência", async () => {
    const res = await request(app)
      .post("/api/payslips/lote/previa")
      .set(as(empresa.rhToken))
      .send(corpo(LOTE));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.total_pages).toBe(9);
    expect(res.body.resumo).toEqual({
      conferem: 6,
      substituem: 0,
      de_fora: 2,
      paginas_sem_funcionario: 0,
    });

    const partes = res.body.parts as Parte[];
    const por = (matricula: string) => partes.find((p) => p.registration === matricula)!;
    expect(por("000020")).toMatchObject({
      pages: [3, 4],
      situacao: "CONFERE",
      user_id: pessoa["José Antunes"],
    });
    expect(por("000019").user_id, "cadastro com zeros à esquerda").toBe(pessoa["Carlos Pereira"]);
    expect(por("000099")).toMatchObject({ pages: [7], situacao: "SEM_CADASTRO", user_id: null });
    expect(por("000018")).toMatchObject({ pages: [9], situacao: "NAO_CONFERE" });
    expect(por("000018").motivos.join(" ")).toContain("setembro/2026");
  });

  it("a prévia não grava nada", async () => {
    await request(app)
      .post("/api/payslips/lote/previa")
      .set(as(empresa.rhToken))
      .send(corpo(LOTE));
    expect(await prisma.payslip.count({ where: { organizationId: empresa.orgId } })).toBe(0);
    expect(
      await prisma.notification.count({ where: { organizationId: empresa.orgId } }),
    ).toBe(0);
  });

  it("ficha que ficou na empresa sem o vínculo não recebe, como no envio individual", async () => {
    const sem = await criarPessoa("Rui Barbosa", "77", Role.COLABORADOR);
    await prisma.membership.deleteMany({
      where: { userId: sem.id, organizationId: empresa.orgId },
    });
    const pdf = await pdfDePaginas([paginaDaFolha("000077", "RUI BARBOSA", "OUTUBRO/2026")]);
    const res = await request(app)
      .post("/api/payslips/lote/previa")
      .set(as(empresa.rhToken))
      .send(corpo(pdf));
    expect(res.status).toBe(200);
    expect((res.body.parts as Parte[])[0]).toMatchObject({
      situacao: "SEM_CADASTRO",
      user_id: null,
    });
  });

  it("colaborador não confere nem publica folha", async () => {
    const marcos = await entrar(`lote.10.${SUFIXO}`);
    for (const rota of ["/api/payslips/lote/previa", "/api/payslips/lote"]) {
      const res = await request(app).post(rota).set(as(marcos)).send(corpo(LOTE));
      expect(res.status, rota).toBe(403);
    }
  });

  it("arquivo que não é PDF é recusado antes de ler", async () => {
    const res = await request(app)
      .post("/api/payslips/lote/previa")
      .set(as(empresa.rhToken))
      .send(corpo(LOTE, { mime_type: "image/png" }));
    expect(res.status).toBe(400);
  });
});

describe("publicar a folha [B4-F]", () => {
  let publicacao: request.Response;

  beforeAll(async () => {
    /* Justificativa no lote não vale: Thiago continua de fora. */
    publicacao = await request(app)
      .post("/api/payslips/lote")
      .set(as(empresa.rhToken))
      .send(corpo(LOTE, { override_reason: "Publicar todo mundo" }));
  });

  it("publica os seis que conferem e só eles", async () => {
    expect(publicacao.status, JSON.stringify(publicacao.body)).toBe(201);
    expect(publicacao.body.publicados).toBe(6);
    expect(publicacao.body.substituidos).toBe(0);

    const holerites = await prisma.payslip.findMany({
      where: { organizationId: empresa.orgId },
      select: { userId: true, referenceMonth: true, referenceYear: true, overrideReason: true },
    });
    expect(holerites.map((h) => h.userId).sort()).toEqual(
      [
        "Marcos Oliveira",
        "Carlos Pereira",
        "José Antunes",
        "Paulo Ribeiro",
        "Eduardo Nunes",
        "Wagner Dias",
      ]
        .map((n) => pessoa[n])
        .sort(),
    );
    expect(holerites.every((h) => h.referenceMonth === 10 && h.referenceYear === 2026)).toBe(true);
    expect(holerites.every((h) => h.overrideReason === null)).toBe(true);
  });

  it("cada arquivo gravado tem só as páginas da pessoa", async () => {
    const holerites = await prisma.payslip.findMany({
      where: { organizationId: empresa.orgId },
      select: { userId: true, storagePath: true },
    });
    for (const h of holerites) {
      const paginas = await extractPdfPages(
        readFileSync(resolveStoragePath(h.storagePath)),
        20,
      );
      const esperado = h.userId === pessoa["José Antunes"] ? 2 : 1;
      expect(paginas, h.userId).toHaveLength(esperado);
      const pessoas = new Set(
        paginas!.flatMap((p) => extractEmployeeEntries(p).map((e) => e.registration)),
      );
      expect(pessoas.size, `${h.userId}: uma pessoa só no arquivo`).toBe(1);
    }
  });

  it("um aviso por pessoa publicada, e o lote na auditoria", async () => {
    const avisos = await prisma.notification.findMany({
      where: { organizationId: empresa.orgId, kind: NotificationKind.PAYSLIP_PUBLISHED },
      select: { userId: true },
    });
    expect(avisos).toHaveLength(6);
    expect(new Set(avisos.map((a) => a.userId)).size).toBe(6);

    const lote = await prisma.auditEvent.findMany({
      where: { organizationId: empresa.orgId, action: "payslip.batch" },
    });
    expect(lote).toHaveLength(1);
    expect(lote[0]!.after).toMatchObject({
      fileName: "folha-outubro.pdf",
      referenceMonth: 10,
      referenceYear: 2026,
      totalPages: 9,
      published: 6,
      replaced: 0,
      refused: 2,
    });
    expect(
      await prisma.auditEvent.count({
        where: { organizationId: empresa.orgId, action: "payslip.create" },
      }),
    ).toBe(6);
  });

  it("cada funcionário vê só o próprio holerite", async () => {
    const marcos = await entrar(`lote.10.${SUFIXO}`);
    const lista = await request(app).get("/api/payslips").set(as(marcos));
    expect(lista.status).toBe(200);
    const meus = lista.body.payslips as { id: string; userId?: string; user_id?: string }[];
    expect(meus).toHaveLength(1);

    const doJose = await prisma.payslip.findFirstOrThrow({
      where: { organizationId: empresa.orgId, userId: pessoa["José Antunes"] },
    });
    const alheio = await request(app).get(`/api/payslips/${doJose.id}/file`).set(as(marcos));
    expect([403, 404]).toContain(alheio.status);
  });

  it("publicar o mesmo arquivo de novo substitui, e a prévia avisa antes", async () => {
    const previa = await request(app)
      .post("/api/payslips/lote/previa")
      .set(as(empresa.rhToken))
      .send(corpo(LOTE));
    expect(previa.body.resumo.substituem).toBe(6);

    const de_novo = await request(app)
      .post("/api/payslips/lote")
      .set(as(empresa.rhToken))
      .send(corpo(LOTE));
    expect(de_novo.status).toBe(201);
    expect(de_novo.body.substituidos).toBe(6);
    expect(
      await prisma.payslipVersion.count({ where: { payslip: { organizationId: empresa.orgId } } }),
    ).toBe(6);
  });
});

describe("a folha de uma loja inteira [B4-F]", () => {
  it("um arquivo de 30 páginas publica 30 holerites", async () => {
    const paginas: string[][] = [];
    for (let i = 0; i < 30; i += 1) {
      const matricula = String(3001 + i);
      /* Nome de gente não tem dígito: a leitura da folha para no número. */
      const letras = String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26));
      const nome = `Pessoa ${letras} Silva`;
      await criarPessoa(nome, matricula, Role.COLABORADOR);
      paginas.push(paginaDaFolha(matricula.padStart(6, "0"), nome.toUpperCase(), "NOVEMBRO/2026"));
    }
    const pdf = await pdfDePaginas(paginas);
    const res = await request(app)
      .post("/api/payslips/lote")
      .set(as(empresa.rhToken))
      .send(corpo(pdf, { reference_month: 11 }));
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
    expect(res.body.publicados).toBe(30);
    expect(res.body.resumo.de_fora).toBe(0);
    expect(
      await prisma.payslip.count({
        where: { organizationId: empresa.orgId, referenceMonth: 11, referenceYear: 2026 },
      }),
    ).toBe(30);
  });
});
