import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Atestado é dado de saúde: o ADM loja vê pessoa, datas, dias ou horas e
 * situação, sem o arquivo, sem CID e sem motivo; aceitar e recusar é só do
 * RH (com Master e Dono). Decisão P-6 do Léo. [C4-15]
 *
 * Empresa própria: a Loja, com o ADM loja que a gere, a Rita do RH e a Ana,
 * que envia o atestado. Apagada no fim.
 */
const SUFIXO = Date.now().toString(36);
const SENHA = ["c415", "atestado", "rh"].join("-");
const as = (t: string) => ({ Authorization: `Bearer ${t}` });

let app: Express;
let orgId = "";
let contaId = "";
const usuarios: string[] = [];
const token: Record<string, string> = {};
let atestado = "";

async function pessoa(chave: string, role: Role, loja: string, gere = false) {
  const login = `c415.${chave}.${SUFIXO}`;
  const user = await prisma.user.create({ data: { login, name: `Pessoa ${chave}`, passwordHash: await bcrypt.hash(SENHA, 4) } });
  usuarios.push(user.id);
  const m = await prisma.membership.create({ data: { userId: user.id, organizationId: orgId, role } });
  await prisma.accountMembership.create({ data: { accountId: contaId, userId: user.id, role: AccountRole.USER } });
  await prisma.employeeProfile.create({ data: { organizationId: orgId, userId: user.id, establishmentId: loja } });
  if (gere) {
    await prisma.managedEstablishment.create({
      data: { organizationId: orgId, membershipId: m.id, establishmentId: loja, createdById: user.id },
    });
  }
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  token[chave] = res.body.token;
}

beforeAll(async () => {
  app = createApp();
  orgId = (await prisma.organization.create({ data: { name: `C415 ${SUFIXO}` } })).id;
  contaId = (await prisma.account.create({ data: { organizationId: orgId, name: `Conta C415 ${SUFIXO}` } })).id;
  const loja = (await prisma.establishment.create({ data: { organizationId: orgId, name: `Loja ${SUFIXO}` } })).id;
  await pessoa("ana", Role.COLABORADOR, loja);
  await pessoa("adm", Role.ADM_LOJA, loja, true);
  await pessoa("rita", Role.RH, loja);
  const envio = await request(app)
    .post("/api/medical-certificates")
    .set(as(token.ana!))
    .send({
      start_date: "2026-11-10",
      days: 2,
      cid: "J11",
      reason: "Gripe",
      file_name: "atestado.pdf",
      mime_type: "application/pdf",
      content_base64: Buffer.from("%PDF-1.4 atestado").toString("base64"),
    });
  expect(envio.status, JSON.stringify(envio.body)).toBe(201);
  atestado = envio.body.certificate.id;
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { organizationId: orgId } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.medicalCertificate.deleteMany({ where: { organizationId: orgId } });
  await prisma.managedEstablishment.deleteMany({ where: { organizationId: orgId } });
  await prisma.employeeProfile.deleteMany({ where: { organizationId: orgId } });
  await prisma.accountMembership.deleteMany({ where: { accountId: contaId } });
  await prisma.membership.deleteMany({ where: { organizationId: orgId } });
  await prisma.token.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.establishment.deleteMany({ where: { organizationId: orgId } });
  await prisma.account.deleteMany({ where: { id: contaId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
});

describe("o ADM loja vê a ausência, não o atestado [C4-15]", () => {
  it("na lista: pessoa, datas e situação; sem CID, sem motivo e sem arquivo", async () => {
    const res = await request(app).get("/api/medical-certificates").set(as(token.adm!));
    expect(res.status).toBe(200);
    const linha = res.body.certificates.find((c: { id: string }) => c.id === atestado);
    expect(linha).toMatchObject({ days: 2, status: "PENDING", cid: null, reason: null, can_open_file: false });
    expect(linha.user.name).toBe("Pessoa ana");
    expect(JSON.stringify(res.body)).not.toContain("J11");
    expect(JSON.stringify(res.body)).not.toContain("Gripe");
  });

  it("o arquivo responde como inexistente, e aceitar ou recusar é recusado", async () => {
    expect((await request(app).get(`/api/medical-certificates/${atestado}/file`).set(as(token.adm!))).status).toBe(404);
    const decide = await request(app)
      .post(`/api/medical-certificates/${atestado}/review`)
      .set(as(token.adm!))
      .send({ status: "APPROVED" });
    expect(decide.status).toBe(403);
    expect(decide.body.message).toBe("Só o RH aceita ou recusa atestado.");
  });

  it("o RH vê tudo, abre o arquivo e decide; a própria pessoa vê o seu inteiro", async () => {
    const lista = await request(app).get("/api/medical-certificates").set(as(token.rita!));
    expect(lista.body.certificates.find((c: { id: string }) => c.id === atestado)).toMatchObject({
      cid: "J11",
      reason: "Gripe",
      can_open_file: true,
    });
    expect((await request(app).get(`/api/medical-certificates/${atestado}/file`).set(as(token.rita!))).status).toBe(200);
    const propria = await request(app).get("/api/medical-certificates").set(as(token.ana!));
    expect(propria.body.certificates[0]).toMatchObject({ cid: "J11", can_open_file: true });
    const decide = await request(app)
      .post(`/api/medical-certificates/${atestado}/review`)
      .set(as(token.rita!))
      .send({ status: "APPROVED" });
    expect(decide.status, JSON.stringify(decide.body)).toBe(200);
  });
});
