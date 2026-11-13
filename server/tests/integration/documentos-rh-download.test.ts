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
 * O arquivo dos documentos do RH (decisão do Léo, 12/11): baixa a pessoa a
 * quem o documento se destina e o RH, com Master e Dono. Documento geral se
 * destina a todos.
 *
 * Empresa própria do teste com a Loja e o Depósito. A Ana e a Bia trabalham
 * na Loja e o Caio no Depósito; o Otto é ADM loja só da Loja; o Gil é
 * gerente. Uma segunda empresa tem o seu RH.
 *
 * Apagadas no fim, com os arquivos gravados.
 */
const SUFIXO = Date.now().toString(36);
const SENHA = ["docrh", "baixar", "arquivo"].join("-");
const as = (t: string) => ({ Authorization: `Bearer ${t}` });

let app: Express;
const orgs: { id: string; conta: string }[] = [];
const usuarios: string[] = [];
const id: Record<string, string> = {};
const token: Record<string, string> = {};
let loja = "";
let deposito = "";
let pessoal = "";
let doCaio = "";
let geral = "";
const CONTRATO = Buffer.from("%PDF-1.4 contrato de experiencia da Ana");
const POLITICA = Buffer.from("%PDF-1.4 politica de uso de EPI");

async function empresa(nome: string) {
  const org = await prisma.organization.create({ data: { name: `DOCRH ${nome} ${SUFIXO}` } });
  const conta = await prisma.account.create({ data: { organizationId: org.id, name: `Conta DOCRH ${nome} ${SUFIXO}` } });
  orgs.push({ id: org.id, conta: conta.id });
  return { orgId: org.id, contaId: conta.id };
}

async function pessoa(
  nome: string,
  role: Role,
  e: { orgId: string; contaId: string },
  filial: string | null = null,
) {
  const login = `docrh.${nome.toLowerCase()}.${SUFIXO}`;
  const user = await prisma.user.create({
    data: { login, name: `${nome} ${SUFIXO}`, passwordHash: await bcrypt.hash(SENHA, 4) },
  });
  usuarios.push(user.id);
  id[nome] = user.id;
  const m = await prisma.membership.create({ data: { userId: user.id, organizationId: e.orgId, role } });
  await prisma.accountMembership.create({ data: { accountId: e.contaId, userId: user.id, role: AccountRole.USER } });
  if (filial) {
    await prisma.employeeProfile.create({ data: { organizationId: e.orgId, userId: user.id, establishmentId: filial } });
  }
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  token[nome] = res.body.token;
  return m.id;
}

const baixar = (quem: string, doc: string) =>
  request(app)
    .get(`/api/hr-documents/${doc}/arquivo`)
    .set(as(token[quem]!))
    .buffer(true)
    .parse((res, cb) => {
      const partes: Buffer[] = [];
      res.on("data", (c: Buffer) => partes.push(c));
      res.on("end", () => cb(null, Buffer.concat(partes)));
    });

beforeAll(async () => {
  app = createApp();
  const e = await empresa("Grupo");
  loja = (await prisma.establishment.create({ data: { organizationId: e.orgId, name: `Loja ${SUFIXO}` } })).id;
  await pessoa("Rita", Role.RH, e);
  await pessoa("Mia", Role.MASTER, e);
  await pessoa("Dora", Role.OWNER, e);
  await pessoa("Ana", Role.COLABORADOR, e, loja);
  await pessoa("Bia", Role.COLABORADOR, e, loja);
  deposito = (await prisma.establishment.create({ data: { organizationId: e.orgId, name: `Deposito ${SUFIXO}` } })).id;
  await pessoa("Caio", Role.COLABORADOR, e, deposito);
  await pessoa("Gil", Role.GERENTE, e, loja);
  const otto = await pessoa("Otto", Role.ADM_LOJA, e, loja);
  await prisma.managedEstablishment.create({
    data: { organizationId: e.orgId, membershipId: otto, establishmentId: loja, createdById: id.Rita! },
  });
  await pessoa("Fora", Role.RH, await empresa("Outra"));

  const publicar = async (titulo: string, arquivo: Buffer, alvo?: string) => {
    const res = await request(app)
      .post("/api/hr-documents")
      .set(as(token.Rita!))
      .send({
        title: titulo,
        file_name: `${titulo}.pdf`,
        mime_type: "application/pdf",
        content_base64: arquivo.toString("base64"),
        ...(alvo ? { target_user_id: alvo } : {}),
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.document.id as string;
  };
  pessoal = await publicar("contrato-ana", CONTRATO, id.Ana);
  geral = await publicar("politica-epi", POLITICA);
  doCaio = await publicar("advertencia-caio", CONTRATO, id.Caio);
});

afterAll(async () => {
  for (const o of orgs) {
    await prisma.notification.deleteMany({ where: { organizationId: o.id } });
    await prisma.auditEvent.deleteMany({ where: { organizationId: o.id } });
    await prisma.hrDocumentAck.deleteMany({ where: { document: { organizationId: o.id } } });
    await prisma.hrDocument.deleteMany({ where: { organizationId: o.id } });
    await prisma.managedEstablishment.deleteMany({ where: { organizationId: o.id } });
    await prisma.employeeProfile.deleteMany({ where: { organizationId: o.id } });
    await prisma.accountMembership.deleteMany({ where: { accountId: o.conta } });
    await prisma.membership.deleteMany({ where: { organizationId: o.id } });
  }
  await prisma.token.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
  for (const o of orgs) {
    await prisma.establishment.deleteMany({ where: { organizationId: o.id } });
    await prisma.account.deleteMany({ where: { id: o.conta } });
    await prisma.organization.deleteMany({ where: { id: o.id } });
    rmSync(join(uploadsRoot(), o.id), { recursive: true, force: true });
  }
});

describe("quem baixa o documento pessoal", () => {
  it("a Ana, a quem se destina, baixa o próprio arquivo, e fica com a leitura marcada", async () => {
    const res = await baixar("Ana", pessoal);
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, CONTRATO)).toBe(0);
    expect(res.headers["content-disposition"]).toContain("contrato-ana.pdf");
    const ack = await prisma.hrDocumentAck.findUnique({
      where: { documentId_userId: { documentId: pessoal, userId: id.Ana! } },
    });
    expect(ack?.readAt).toBeTruthy();
    expect(ack?.acknowledgedAt).toBeNull();
  });

  it("RH, Master e Dono baixam, e cada download fica na auditoria", async () => {
    for (const quem of ["Rita", "Mia", "Dora"]) {
      const res = await baixar(quem, pessoal);
      expect(res.status, quem).toBe(200);
      expect(Buffer.compare(res.body as Buffer, CONTRATO), quem).toBe(0);
    }
    const trilha = await prisma.auditEvent.findMany({
      where: { action: "hr_document.download", entityId: pessoal },
      select: { actorId: true },
    });
    expect(trilha.map((t) => t.actorId).sort()).toEqual([id.Rita, id.Mia, id.Dora].sort());
    /* Quem baixa o documento de outra pessoa não ganha leitura em nome próprio. */
    expect(
      await prisma.hrDocumentAck.count({ where: { documentId: pessoal, userId: { in: [id.Rita!, id.Mia!, id.Dora!] } } }),
    ).toBe(0);
  });

  it("o ADM loja vê a linha, mas o arquivo não sai para ele", async () => {
    const res = await baixar("Otto", pessoal);
    expect(res.status).toBe(403);
    expect(JSON.parse((res.body as Buffer).toString()).message).toBe(
      "O arquivo sai só para a pessoa a quem o documento se destina e para o RH.",
    );
  });

  it("a colega e o gerente, que não veem o documento, recebem 'não encontrado'", async () => {
    for (const quem of ["Bia", "Gil"]) {
      expect((await baixar(quem, pessoal)).status, quem).toBe(404);
    }
  });

  it("o ADM loja não alcança o documento de quem é de outra filial: 'não encontrado', não 403", async () => {
    const res = await baixar("Otto", doCaio);
    expect(res.status).toBe(404);
    expect(JSON.parse((res.body as Buffer).toString()).message).toBe("Documento não encontrado.");
    expect(
      await prisma.auditEvent.count({ where: { action: "hr_document.download", entityId: doCaio } }),
    ).toBe(0);
    /* O mesmo documento sai para o RH, que alcança a empresa inteira. */
    expect((await baixar("Rita", doCaio)).status).toBe(200);
  });

  it("o RH de outra empresa não alcança", async () => {
    expect((await baixar("Fora", pessoal)).status).toBe(404);
    expect((await baixar("Fora", geral)).status).toBe(404);
  });
});

describe("o documento geral se destina a todos", () => {
  it("a colega, o gerente e o ADM loja baixam a política", async () => {
    for (const quem of ["Bia", "Gil", "Otto"]) {
      const res = await baixar(quem, geral);
      expect(res.status, quem).toBe(200);
      expect(Buffer.compare(res.body as Buffer, POLITICA), quem).toBe(0);
    }
  });
});

describe("a lista diz onde aparece o botão", () => {
  const podeNaLista = async (quem: string) => {
    const res = await request(app).get("/api/hr-documents").set(as(token[quem]!));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return Object.fromEntries(
      (res.body.documents as { id: string; can_download: boolean; storagePath?: string }[]).map((d) => {
        expect(d.storagePath, "o caminho interno não sai").toBeUndefined();
        return [d.id, d.can_download];
      }),
    );
  };

  it("Ana e RH: os dois arquivos; ADM loja: só o geral; colega: só o geral", async () => {
    expect(await podeNaLista("Ana")).toEqual({ [pessoal]: true, [geral]: true });
    expect(await podeNaLista("Rita")).toEqual({ [pessoal]: true, [geral]: true, [doCaio]: true });
    expect(await podeNaLista("Otto")).toEqual({ [pessoal]: false, [geral]: true });
    expect(await podeNaLista("Bia")).toEqual({ [geral]: true });
  });
});
