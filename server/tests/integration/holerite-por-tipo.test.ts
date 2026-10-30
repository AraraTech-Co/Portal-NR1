import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { AccountRole, NotificationKind, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { uploadsRoot } from "../../src/helper/uploads";
import { pdfBase64 } from "../helpers/pdf";

/**
 * Adiantamento e folha mensal do mesmo mês são dois holerites. [B4-G]
 *
 * A loja publica o adiantamento (dia 18) e a folha mensal com a mesma
 * competência. Sem o tipo, o segundo envio substituía o primeiro como se
 * fosse correção. Agora o holerite é único por pessoa, competência e tipo, e
 * só o mesmo tipo substitui.
 *
 * Os dois PDFs de exemplo são fictícios, no layout da loja: o lote mensal de
 * outubro/2026 e o adiantamento de Marcos, Carlos e Paulo.
 */
const SUFIXO = Date.now().toString(36);
const SENHA = "s".repeat(4) + "-" + "9".repeat(4);
const FIXTURES = join(__dirname, "..", "fixtures", "holerites");
const MENSAL = readFileSync(join(FIXTURES, "lote-mensal-outubro-2026.pdf"));
const ADIANTAMENTO = readFileSync(join(FIXTURES, "adiantamento-outubro-2026.pdf"));
const MIGRACAO = readFileSync(
  join(__dirname, "../../../prisma/migrations/20261101000000_holerite_tipo/migration.sql"),
  "utf8",
);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const lote = (pdf: Buffer, kind?: string) => ({
  reference_month: 10,
  reference_year: 2026,
  file_name: "folha.pdf",
  mime_type: "application/pdf",
  content_base64: pdf.toString("base64"),
  ...(kind ? { kind } : {}),
});

let app: Express;
const empresa = { orgId: "", contaId: "", rhToken: "", usuarios: [] as string[] };
const pessoa: Record<string, { id: string; login: string }> = {};

async function criarPessoa(nome: string, matricula: string, role: Role) {
  const login = `tipo.${matricula}.${SUFIXO}`.toLowerCase();
  const user = await prisma.user.create({
    data: { login, email: `${login}@teste.local`, name: nome, passwordHash: await bcrypt.hash(SENHA, 4) },
  });
  empresa.usuarios.push(user.id);
  await prisma.membership.create({ data: { userId: user.id, organizationId: empresa.orgId, role } });
  await prisma.accountMembership.create({
    data: { accountId: empresa.contaId, userId: user.id, role: AccountRole.USER },
  });
  await prisma.employeeProfile.create({
    data: { organizationId: empresa.orgId, userId: user.id, registration: matricula },
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
  const org = await prisma.organization.create({ data: { name: `Tipo ${SUFIXO}` } });
  empresa.orgId = org.id;
  const conta = await prisma.account.create({ data: { organizationId: org.id, name: `Conta ${SUFIXO}` } });
  empresa.contaId = conta.id;
  const rh = await criarPessoa("Rita do RH", `RH${SUFIXO}`, Role.RH);
  empresa.rhToken = await entrar(rh.login);
  for (const [nome, matricula] of [
    ["Marcos Oliveira", "10"],
    ["Carlos Pereira", "19"],
    ["José Antunes", "20"],
    ["Paulo Ribeiro", "21"],
    ["Eduardo Nunes", "22"],
    ["Wagner Dias", "25"],
  ] as const) {
    pessoa[nome] = await criarPessoa(nome, matricula, Role.COLABORADOR);
  }
});

afterAll(async () => {
  if (!empresa.orgId) return;
  await prisma.notification.deleteMany({ where: { organizationId: empresa.orgId } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: empresa.orgId } });
  await prisma.payslipVersion.deleteMany({ where: { payslip: { organizationId: empresa.orgId } } });
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

describe("a folha mensal e depois o adiantamento do mesmo mês [B4-G]", () => {
  it("o lote sem tipo é a folha mensal", async () => {
    const res = await request(app).post("/api/payslips/lote").set(as(empresa.rhToken)).send(lote(MENSAL));
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.publicados).toBe(6);
    const tipos = await prisma.payslip.findMany({
      where: { organizationId: empresa.orgId },
      select: { kind: true },
    });
    expect(tipos.every((t) => t.kind === "MONTHLY")).toBe(true);
  });

  it("a prévia do adiantamento não acusa substituição", async () => {
    const res = await request(app)
      .post("/api/payslips/lote/previa")
      .set(as(empresa.rhToken))
      .send(lote(ADIANTAMENTO, "ADVANCE"));
    expect(res.status).toBe(200);
    expect(res.body.resumo).toMatchObject({ conferem: 3, substituem: 0, de_fora: 0 });
  });

  it("Marcos, Carlos e Paulo ficam com dois holerites de outubro, sem aviso de substituição", async () => {
    const res = await request(app)
      .post("/api/payslips/lote")
      .set(as(empresa.rhToken))
      .send(lote(ADIANTAMENTO, "ADVANCE"));
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body).toMatchObject({ publicados: 3, substituidos: 0 });

    for (const nome of ["Marcos Oliveira", "Carlos Pereira", "Paulo Ribeiro"]) {
      const deles = await prisma.payslip.findMany({
        where: { organizationId: empresa.orgId, userId: pessoa[nome]!.id, referenceMonth: 10 },
        select: { kind: true },
        orderBy: { kind: "asc" },
      });
      expect(deles.map((d) => d.kind), nome).toEqual(["MONTHLY", "ADVANCE"]);
    }
    expect(
      await prisma.payslipVersion.count({ where: { payslip: { organizationId: empresa.orgId } } }),
      "nada virou versão anterior",
    ).toBe(0);

    const avisos = await prisma.notification.findMany({
      where: {
        organizationId: empresa.orgId,
        userId: pessoa["Marcos Oliveira"]!.id,
        kind: NotificationKind.PAYSLIP_PUBLISHED,
      },
      select: { title: true, body: true },
      orderBy: { createdAt: "asc" },
    });
    expect(avisos.map((a) => a.title)).toEqual(["Holerite de 10/2026", "Adiantamento de 10/2026"]);
    expect(avisos.map((a) => a.body)).toEqual([
      "Seu holerite está disponível.",
      "Seu holerite está disponível.",
    ]);

    const arquivos = await prisma.payslip.findMany({
      where: { organizationId: empresa.orgId, userId: pessoa["Marcos Oliveira"]!.id },
      select: { fileName: true },
      orderBy: { kind: "asc" },
    });
    expect(arquivos.map((a) => a.fileName)).toEqual([
      "holerite-10-2026-000010.pdf",
      "adiantamento-10-2026-000010.pdf",
    ]);
  });

  it("o funcionário vê os dois, cada um com o seu tipo", async () => {
    const marcos = await entrar(pessoa["Marcos Oliveira"]!.login);
    const res = await request(app).get("/api/payslips").set(as(marcos));
    expect(res.status).toBe(200);
    expect((res.body.payslips as { kind: string }[]).map((p) => p.kind)).toEqual([
      "MONTHLY",
      "ADVANCE",
    ]);
  });

  it("o mesmo tipo de novo substitui, e só ele", async () => {
    const res = await request(app)
      .post("/api/payslips/lote")
      .set(as(empresa.rhToken))
      .send(lote(ADIANTAMENTO, "ADVANCE"));
    expect(res.body).toMatchObject({ publicados: 3, substituidos: 3 });
    expect(
      await prisma.payslip.count({ where: { organizationId: empresa.orgId, referenceMonth: 10 } }),
    ).toBe(9);
    const versoes = await prisma.payslipVersion.findMany({
      where: { payslip: { organizationId: empresa.orgId } },
      select: { payslip: { select: { kind: true } } },
    });
    expect(versoes.map((v) => v.payslip.kind)).toEqual(["ADVANCE", "ADVANCE", "ADVANCE"]);
  });
});

describe("o envio individual também tem tipo [B4-G]", () => {
  const holerite = (matricula: string, nome: string) =>
    pdfBase64([
      "0001 - EMPRESA TESTE LTDA",
      "OUTUBRO/2026",
      `${matricula} - ${nome}   15/01/2024`,
      "1520 ADIANTAMENTO DE SALARIO   1.540,00",
      "TOTAL LIQUIDO 1.540,00",
    ]);
  const envio = (kind?: string) => ({
    user_id: pessoa["Eduardo Nunes"]!.id,
    reference_month: 10,
    reference_year: 2026,
    file_name: "adiantamento.pdf",
    mime_type: "application/pdf",
    content_base64: holerite("000022", "EDUARDO NUNES"),
    ...(kind !== undefined ? { kind } : {}),
  });

  it("o adiantamento de quem já tem a mensal entra ao lado, não por cima", async () => {
    const res = await request(app).post("/api/payslips").set(as(empresa.rhToken)).send(envio("ADVANCE"));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.replaced).toBe(false);
    expect(res.body.payslip.kind).toBe("ADVANCE");
  });

  it("tipo que não existe é recusado, inclusive nome do protótipo", async () => {
    for (const kind of ["BONUS", "constructor", "toString"]) {
      const res = await request(app).post("/api/payslips").set(as(empresa.rhToken)).send(envio(kind));
      expect(res.status, kind).toBe(400);
    }
    const lote400 = await request(app)
      .post("/api/payslips/lote/previa")
      .set(as(empresa.rhToken))
      .send(lote(MENSAL, "BONUS"));
    expect(lote400.status).toBe(400);
  });
});

describe("a migração do tipo [B4-G]", () => {
  /*
    Dentro de uma transação desfeita no fim: o banco volta ao estado de antes
    do tipo (sem a coluna, com o índice antigo), com os holerites deste
    arquivo já gravados, e a migração roda duas vezes.
  */
  it("a partir do banco de antes, roda duas vezes, os existentes ficam mensais e só o índice novo fica", async () => {
    const DESFAZER = new Error("desfazer");
    let conferido = false;
    await prisma
      .$transaction(async (tx) => {
        /* Uma instrução por chamada; o bloco DO $$ … $$ vai inteiro. */
        const instrucoes =
          MIGRACAO.replace(/^--.*$/gm, "").match(/\s*DO \$\$[\s\S]*?\$\$;|[^;]+;/g) ?? [];
        expect(instrucoes.length, "as quatro instruções da migração").toBe(4);
        const antes = await tx.payslip.count({ where: { organizationId: empresa.orgId } });
        /*
          O estado de antes: só um holerite por pessoa e mês, sem tipo. Na
          tabela inteira — outro arquivo, ou a conferência na tela, pode ter
          deixado adiantamento — e desfeito no fim, como o resto.
        */
        await tx.payslip.deleteMany({ where: { kind: { not: "MONTHLY" } } });
        const mensais = await tx.payslip.count({ where: { organizationId: empresa.orgId } });
        expect(mensais).toBeGreaterThan(0);
        expect(mensais).toBeLessThan(antes);
        await tx.$executeRawUnsafe(
          `DROP INDEX "Payslip_organizationId_userId_referenceYear_referenceMonth__key"`,
        );
        await tx.$executeRawUnsafe(`ALTER TABLE "Payslip" DROP COLUMN "kind"`);
        await tx.$executeRawUnsafe(`DROP TYPE "PayslipKind"`);
        await tx.$executeRawUnsafe(
          `CREATE UNIQUE INDEX "Payslip_organizationId_userId_referenceYear_referenceMonth_key" ON "Payslip"("organizationId", "userId", "referenceYear", "referenceMonth")`,
        );

        for (let vez = 0; vez < 2; vez += 1) {
          for (const sql of instrucoes) await tx.$executeRawUnsafe(sql);
        }

        const tipos = await tx.$queryRawUnsafe<{ kind: string; n: bigint }[]>(
          `SELECT "kind"::text AS kind, count(*) AS n FROM "Payslip" WHERE "organizationId" = $1 GROUP BY 1`,
          empresa.orgId,
        );
        expect(tipos.map((t) => [t.kind, Number(t.n)])).toEqual([["MONTHLY", mensais]]);
        const indices = await tx.$queryRawUnsafe<{ indexname: string }[]>(
          `SELECT indexname FROM pg_indexes WHERE tablename = 'Payslip' ORDER BY indexname`,
        );
        const nomes = indices.map((i) => i.indexname);
        expect(nomes).toContain("Payslip_organizationId_userId_referenceYear_referenceMonth__key");
        expect(nomes).not.toContain("Payslip_organizationId_userId_referenceYear_referenceMonth_key");
        const padrao = await tx.$queryRawUnsafe<{ column_default: string }[]>(
          `SELECT column_default FROM information_schema.columns WHERE table_name = 'Payslip' AND column_name = 'kind'`,
        );
        expect(padrao[0]!.column_default).toContain("MONTHLY");
        conferido = true;
        throw DESFAZER;
      })
      .catch((e) => {
        if (e !== DESFAZER) throw e;
      });
    expect(conferido).toBe(true);
  });
});
