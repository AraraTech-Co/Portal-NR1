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

/**
 * Publicar documento do RH para uma pessoa, uma filial ou a empresa
 * (desenho de 13/11, item 10).
 *
 * Empresa própria do teste com a Loja A e a Loja B:
 * - Rita (RH), Mia (Master), Dora (Dono) e Sara (SST) veem a empresa inteira;
 * - Otto é ADM loja da A e trabalha nela;
 * - Ana trabalha na A, Bia na B, e Caio, da A, está desligado.
 *
 * Apagada no fim, com os arquivos.
 */
const SUFIXO = Date.now().toString(36);
const SENHA = ["docrh", "publicar", "filial"].join("-");
const as = (t: string) => ({ Authorization: `Bearer ${t}` });
const PDF = Buffer.from("%PDF-1.4 documento do teste");
const PNG = Buffer.concat([Buffer.from([0x89]), Buffer.from("PNG\r\n\x1a\n imagem")]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const EXE = Buffer.from("MZ\x90\x00 programa");

let app: Express;
let orgId = "";
let contaId = "";
let lojaA = "";
let lojaB = "";
const usuarios: string[] = [];
const id: Record<string, string> = {};
const token: Record<string, string> = {};

async function pessoa(
  nome: string,
  role: Role,
  ficha?: { loja: string; desligado?: boolean },
  gere?: string,
) {
  const login = `pub.${nome.toLowerCase()}.${SUFIXO}`;
  const user = await prisma.user.create({ data: { login, name: `${nome} ${SUFIXO}`, passwordHash: await bcrypt.hash(SENHA, 4) } });
  usuarios.push(user.id);
  id[nome] = user.id;
  const m = await prisma.membership.create({ data: { userId: user.id, organizationId: orgId, role } });
  await prisma.accountMembership.create({ data: { accountId: contaId, userId: user.id, role: AccountRole.USER } });
  if (ficha) {
    await prisma.employeeProfile.create({
      data: {
        organizationId: orgId,
        userId: user.id,
        establishmentId: ficha.loja,
        dismissedAt: ficha.desligado ? new Date("2026-10-31") : null,
      },
    });
  }
  if (gere) {
    await prisma.managedEstablishment.create({
      data: { organizationId: orgId, membershipId: m.id, establishmentId: gere, createdById: user.id },
    });
  }
  if (!ficha?.desligado) {
    const res = await request(app).post("/api/auth").send({ login, password: SENHA });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    token[nome] = res.body.token;
  }
}

const publicar = (quem: string, extra: Record<string, unknown>, arquivo: Buffer = PDF) =>
  request(app)
    .post("/api/hr-documents")
    .set(as(token[quem]!))
    .send({
      kind: "TERM",
      title: `Política ${SUFIXO} ${Math.random().toString(36).slice(2, 6)}`,
      file_name: "politica.pdf",
      mime_type: "application/pdf",
      content_base64: arquivo.toString("base64"),
      ...extra,
    });

const avisados = async (docId: string) =>
  (
    await prisma.notification.findMany({
      where: { entityType: "HrDocument", entityId: docId, kind: "HR_DOCUMENT_PUBLISHED" },
      select: { userId: true },
    })
  )
    .map((n) => n.userId)
    .sort();

const lista = async (quem: string) => {
  const res = await request(app).get("/api/hr-documents").set(as(token[quem]!));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.documents as { id: string }[]).map((d) => d.id);
};

beforeAll(async () => {
  app = createApp();
  orgId = (await prisma.organization.create({ data: { name: `PUB ${SUFIXO}` } })).id;
  contaId = (await prisma.account.create({ data: { organizationId: orgId, name: `Conta PUB ${SUFIXO}` } })).id;
  lojaA = (await prisma.establishment.create({ data: { organizationId: orgId, name: `Loja A ${SUFIXO}` } })).id;
  lojaB = (await prisma.establishment.create({ data: { organizationId: orgId, name: `Loja B ${SUFIXO}` } })).id;
  await pessoa("Rita", Role.RH);
  await pessoa("Mia", Role.MASTER);
  await pessoa("Dora", Role.OWNER);
  await pessoa("Sara", Role.SST);
  await pessoa("Fred", Role.FISCAL);
  await pessoa("Otto", Role.ADM_LOJA, { loja: lojaA }, lojaA);
  await pessoa("Ana", Role.COLABORADOR, { loja: lojaA });
  await pessoa("Bia", Role.COLABORADOR, { loja: lojaB });
  await pessoa("Caio", Role.COLABORADOR, { loja: lojaA, desligado: true });
});

afterAll(async () => {
  if (!orgId) return;
  await prisma.notification.deleteMany({ where: { organizationId: orgId } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.hrDocumentAck.deleteMany({ where: { document: { organizationId: orgId } } });
  await prisma.hrDocument.deleteMany({ where: { organizationId: orgId } });
  await prisma.managedEstablishment.deleteMany({ where: { organizationId: orgId } });
  await prisma.employeeProfile.deleteMany({ where: { organizationId: orgId } });
  await prisma.accountMembership.deleteMany({ where: { accountId: contaId } });
  await prisma.membership.deleteMany({ where: { organizationId: orgId } });
  await prisma.token.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.establishment.deleteMany({ where: { organizationId: orgId } });
  await prisma.account.deleteMany({ where: { id: contaId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  rmSync(join(uploadsRoot(), orgId), { recursive: true, force: true });
});

describe("quem publica o quê", () => {
  it("RH, Master e Dono publicam pessoal, de filial e de toda a empresa", async () => {
    for (const quem of ["Rita", "Mia", "Dora"]) {
      expect((await publicar(quem, { target_user_id: id.Ana })).status, quem).toBe(201);
      expect((await publicar(quem, { establishment_id: lojaB })).status, quem).toBe(201);
      expect((await publicar(quem, {})).status, quem).toBe(201);
    }
  });

  it("o ADM loja não publica pessoal nem de toda a empresa: só da filial que gere", async () => {
    const pessoal = await publicar("Otto", { target_user_id: id.Ana });
    expect(pessoal.status).toBe(403);
    expect(pessoal.body.message).toBe("Documento pessoal só o RH, o Master ou o Dono publicam.");
    const todas = await publicar("Otto", {});
    expect(todas.status).toBe(403);
    expect(todas.body.message).toBe("Escolha a filial: você publica só para as filiais que gere.");
    const outra = await publicar("Otto", { establishment_id: lojaB });
    expect(outra.status).toBe(400);
    expect(outra.body.message).toBe("Filial inválida.");
    expect((await publicar("Otto", { establishment_id: lojaA })).status).toBe(201);
  });

  it("pessoa e filial juntas, ou filial de outra empresa, são recusadas", async () => {
    expect((await publicar("Rita", { target_user_id: id.Ana, establishment_id: lojaA })).status).toBe(400);
    expect((await publicar("Rita", { establishment_id: "00000000-0000-4000-8000-000000000000" })).status).toBe(400);
  });
});

describe("o arquivo", () => {
  it("é obrigatório", async () => {
    const res = await publicar("Rita", {}, Buffer.alloc(0));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Anexe o arquivo do documento.");
  });

  it("o tipo vale pelo conteúdo: PDF, PNG e JPG entram; um programa declarado como PDF, não", async () => {
    for (const [nome, arquivo, mime] of [
      ["pdf", PDF, "application/pdf"],
      ["png", PNG, "image/png"],
      ["jpg", JPG, "image/jpeg"],
    ] as const) {
      const res = await publicar("Rita", {}, arquivo);
      expect(res.status, nome).toBe(201);
      expect(res.body.document.mimeType, nome).toBe(mime);
    }
    const exe = await publicar("Rita", {}, EXE);
    expect(exe.status).toBe(400);
    expect(exe.body.message).toBe("O arquivo precisa ser PDF, PNG ou JPG.");
  });
});

describe("quem é avisado", () => {
  it("pessoal: só a pessoa", async () => {
    const res = await publicar("Rita", { target_user_id: id.Ana });
    expect(await avisados(res.body.document.id)).toEqual([id.Ana]);
  });

  it("de uma filial: quem tem ficha ativa nela, menos quem publicou; o desligado não", async () => {
    const res = await publicar("Otto", { establishment_id: lojaA });
    expect(await avisados(res.body.document.id)).toEqual([id.Ana]);
  });

  it("de toda a empresa: todos com ficha ativa, e só eles", async () => {
    const res = await publicar("Rita", {});
    expect(await avisados(res.body.document.id)).toEqual([id.Ana, id.Bia, id.Otto].sort());
  });
});

describe("quem vê o documento de uma filial", () => {
  let daA = "";
  beforeAll(async () => {
    daA = (await publicar("Rita", { establishment_id: lojaA, requires_ack: true })).body.document.id;
  });

  it("quem trabalha na filial, quem a gere e a central veem; a outra filial, não", async () => {
    for (const quem of ["Ana", "Otto", "Rita", "Sara"]) {
      expect(await lista(quem), quem).toContain(daA);
      expect((await request(app).get(`/api/hr-documents/${daA}`).set(as(token[quem]!))).status, quem).toBe(200);
    }
    expect(await lista("Bia")).not.toContain(daA);
    for (const rota of ["", "/arquivo"]) {
      expect((await request(app).get(`/api/hr-documents/${daA}${rota}`).set(as(token.Bia!))).status, rota).toBe(404);
    }
    expect((await request(app).post(`/api/hr-documents/${daA}/ack`).set(as(token.Bia!))).status).toBe(404);
  });

  it("o botão de ciência só para quem recebe: a Ana sim; o RH e o ADM loja, que só gerem, não", async () => {
    const podeDarCiencia = async (quem: string) => {
      const res = await request(app).get("/api/hr-documents").set(as(token[quem]!));
      return (res.body.documents as { id: string; can_ack: boolean }[]).find((d) => d.id === daA)?.can_ack;
    };
    expect(await podeDarCiencia("Ana")).toBe(true);
    expect(await podeDarCiencia("Rita")).toBe(false);
    /* O Otto trabalha na A, além de geri-la: é de quem se espera a ciência. */
    expect(await podeDarCiencia("Otto")).toBe(true);
    const daEmpresa = (await publicar("Rita", { requires_ack: true })).body.document.id;
    const res = await request(app).get("/api/hr-documents").set(as(token.Bia!));
    expect((res.body.documents as { id: string; can_ack: boolean }[]).find((d) => d.id === daEmpresa)?.can_ack).toBe(true);
  });

  it("a Ana dá ciência e baixa; o fiscal nem abre o módulo", async () => {
    expect((await request(app).post(`/api/hr-documents/${daA}/ack`).set(as(token.Ana!))).status).toBe(200);
    expect((await request(app).get(`/api/hr-documents/${daA}/arquivo`).set(as(token.Ana!))).status).toBe(200);
    /* A pasta do RH saiu do fiscal [CB-43]: a regra da consulta fica para quando abrir. */
    expect((await request(app).get("/api/hr-documents").set(as(token.Fred!))).status).toBe(403);
  });

  it("o ADM loja que deixa de gerir a filial não leva o documento pessoal de quem era dela, mesmo tendo aberto", async () => {
    const pessoal = (await publicar("Rita", { target_user_id: id.Ana })).body.document.id;
    expect((await request(app).get(`/api/hr-documents/${pessoal}`).set(as(token.Otto!))).status).toBe(200);
    const gestao = await prisma.managedEstablishment.findFirstOrThrow({
      where: { organizationId: orgId, establishmentId: lojaA, membership: { userId: id.Otto } },
    });
    const ficha = await prisma.employeeProfile.findFirstOrThrow({ where: { organizationId: orgId, userId: id.Otto } });
    await prisma.managedEstablishment.delete({ where: { id: gestao.id } });
    await prisma.employeeProfile.update({ where: { id: ficha.id }, data: { establishmentId: lojaB } });
    try {
      expect(await lista("Otto")).not.toContain(pessoal);
      expect((await request(app).get(`/api/hr-documents/${pessoal}`).set(as(token.Otto!))).status).toBe(404);
    } finally {
      await prisma.employeeProfile.update({ where: { id: ficha.id }, data: { establishmentId: lojaA } });
      await prisma.managedEstablishment.create({
        data: {
          organizationId: orgId,
          membershipId: gestao.membershipId,
          establishmentId: lojaA,
          createdById: gestao.createdById,
        },
      });
    }
  });

  it("quem muda de filial continua vendo o que já recebeu, deixa de ver o que nunca abriu e passa a ver a nova", async () => {
    const nuncaAberto = (await publicar("Rita", { establishment_id: lojaA })).body.document.id;
    const daB = (await publicar("Rita", { establishment_id: lojaB })).body.document.id;
    const ficha = await prisma.employeeProfile.findFirstOrThrow({ where: { organizationId: orgId, userId: id.Ana } });
    await prisma.employeeProfile.update({ where: { id: ficha.id }, data: { establishmentId: lojaB } });
    try {
      const daAna = await lista("Ana");
      expect(daAna, "a de A em que deu ciência").toContain(daA);
      expect(daAna, "a de A que nunca abriu").not.toContain(nuncaAberto);
      expect(daAna, "a da filial nova").toContain(daB);
      expect((await request(app).get(`/api/hr-documents/${nuncaAberto}/arquivo`).set(as(token.Ana!))).status).toBe(404);
    } finally {
      await prisma.employeeProfile.update({ where: { id: ficha.id }, data: { establishmentId: lojaA } });
    }
  });
});
