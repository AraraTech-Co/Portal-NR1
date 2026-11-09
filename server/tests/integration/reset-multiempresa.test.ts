import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import type { Express } from "express";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * "Redefinir senha" de conta usada em mais de uma empresa.
 *
 * A conta (senha, sessões) é uma só; o vínculo é por empresa. Quem redefine
 * precisa poder redefinir em TODAS as empresas ativas da conta: ter vínculo
 * ativo em cada uma, com papel acima do dela lá e com Conta e usuários.
 * Faltando uma, 409, sem gerar senha nem derrubar sessão.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const ACCOUNT_ID = "aaaaaaaa-0001-4000-8000-000000000002";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: { token: string; user: { id: string } };
let master: { token: string; user: { id: string } };
let outra: string;
const criados: string[] = [];

async function entrar(login: string, password = SENHA) {
  return request(app).post("/api/auth").send({ login, password });
}

/** Uma pessoa desta empresa (A), colaboradora, com a senha do teste. */
async function pessoa(nome: string) {
  const login = `multi.${nome}.${SUFIXO}`;
  const user = await prisma.user.create({
    data: { login, name: `Multi ${nome}`, passwordHash: await bcrypt.hash(SENHA, 4) },
  });
  criados.push(user.id);
  await prisma.accountMembership.create({
    data: { accountId: ACCOUNT_ID, userId: user.id, role: AccountRole.USER },
  });
  await prisma.membership.create({
    data: { userId: user.id, organizationId: ORG_ID, role: Role.COLABORADOR },
  });
  return { id: user.id, login };
}

const redefinir = (token: string, userId: string) =>
  request(app).post(`/api/pessoas-acessos/${userId}/redefinir-senha`).set(as(token));

beforeAll(async () => {
  app = createApp();
  rh = (await entrar("teste.rh")).body;
  master = (await entrar("teste.master")).body;
  outra = (await prisma.organization.create({ data: { name: `Empresa B ${SUFIXO}` } })).id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: criados } } });
  await prisma.membership.deleteMany({ where: { organizationId: outra } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: [outra] } } });
  await prisma.organization.deleteMany({ where: { id: outra } });
});

describe("reset de conta usada em outra empresa", () => {
  it("o RH desta empresa não redefine: 409, a senha e a sessão ficam", async () => {
    const p = await pessoa("ativa");
    await prisma.membership.create({
      data: { userId: p.id, organizationId: outra, role: Role.COLABORADOR },
    });
    const sessao = (await entrar(p.login)).body.token as string;
    const antes = await prisma.user.findUniqueOrThrow({ where: { id: p.id } });

    const res = await redefinir(rh.token, p.id);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe("OTHER_ORG");
    expect(res.body).not.toHaveProperty("temporary_password");

    const depois = await prisma.user.findUniqueOrThrow({ where: { id: p.id } });
    expect(depois.passwordHash).toBe(antes.passwordHash);
    expect(depois.mustChangePassword).toBe(false);
    expect((await request(app).get("/api/auth").set(as(sessao))).status).toBe(200);
    expect((await entrar(p.login)).status).toBe(200);

    const trilha = await prisma.auditEvent.findFirst({
      where: { entityId: p.id, action: "user.password_reset_refused" },
    });
    expect(trilha?.actorId).toBe(rh.user.id);
  });

  it("quem tem papel acima dela nas duas empresas redefine", async () => {
    const p = await pessoa("grupo");
    await prisma.membership.create({
      data: { userId: p.id, organizationId: outra, role: Role.COLABORADOR },
    });
    await prisma.membership.upsert({
      where: { userId_organizationId: { userId: master.user.id, organizationId: outra } },
      create: { userId: master.user.id, organizationId: outra, role: Role.MASTER },
      update: { role: Role.MASTER, suspendedAt: null },
    });
    const res = await redefinir(master.token, p.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(typeof res.body.temporary_password).toBe("string");
  });

  /** Quem age (o RH desta empresa) passa a ter este papel na outra empresa. */
  async function rhNaOutra(
    role: Role,
    estado: { suspendedAt?: Date | null; accessExpiresAt?: Date | null } = {},
  ) {
    const dados = {
      role,
      suspendedAt: estado.suspendedAt ?? null,
      accessExpiresAt: estado.accessExpiresAt ?? null,
    };
    await prisma.membership.upsert({
      where: { userId_organizationId: { userId: rh.user.id, organizationId: outra } },
      create: { userId: rh.user.id, organizationId: outra, ...dados },
      update: dados,
    });
  }

  it("lá, o papel da pessoa não fica abaixo do de quem age: recusa (hierarquia)", async () => {
    // RH aqui e RH lá; a pessoa também é RH lá — mesmo nível, não redefine.
    const p = await pessoa("par-la");
    await prisma.membership.create({ data: { userId: p.id, organizationId: outra, role: Role.RH } });
    await rhNaOutra(Role.RH);
    const res = await redefinir(rh.token, p.id);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe("OTHER_ORG");
  });

  it("lá, quem age está acima mas não cuida de Conta e usuários: recusa (módulo)", async () => {
    // Gerente lá (acima de colaborador), mas gerente não tem Conta e usuários.
    const p = await pessoa("gerente-la");
    await prisma.membership.create({ data: { userId: p.id, organizationId: outra, role: Role.COLABORADOR } });
    await rhNaOutra(Role.GERENTE);
    const res = await redefinir(rh.token, p.id);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe("OTHER_ORG");
  });

  it("lá, quem age é RH e a pessoa colaboradora: redefine", async () => {
    const p = await pessoa("rh-nas-duas");
    await prisma.membership.create({ data: { userId: p.id, organizationId: outra, role: Role.COLABORADOR } });
    await rhNaOutra(Role.RH);
    expect((await redefinir(rh.token, p.id)).status).toBe(200);
  });

  it("o vínculo de QUEM AGE lá precisa estar ativo: RH lá, mas suspenso ou com acesso vencido, recusa", async () => {
    for (const [nome, estado] of [
      ["agente-suspenso", { suspendedAt: new Date() }],
      ["agente-vencido", { accessExpiresAt: new Date(Date.now() - 1000) }],
    ] as const) {
      const p = await pessoa(nome);
      await prisma.membership.create({
        data: { userId: p.id, organizationId: outra, role: Role.COLABORADOR },
      });
      // Seria RH acima da pessoa lá — se o vínculo dele lá estivesse ativo.
      await rhNaOutra(Role.RH, estado);
      const sessao = (await entrar(p.login)).body.token as string;
      const antes = await prisma.user.findUniqueOrThrow({ where: { id: p.id } });

      const res = await redefinir(rh.token, p.id);
      expect(res.status, `${nome}: ${JSON.stringify(res.body)}`).toBe(409);
      expect(res.body.code).toBe("OTHER_ORG");
      const depois = await prisma.user.findUniqueOrThrow({ where: { id: p.id } });
      expect(depois.passwordHash, nome).toBe(antes.passwordHash);
      expect((await request(app).get("/api/auth").set(as(sessao))).status, nome).toBe(200);
    }
    // Canário: com o vínculo dele lá ativo, a mesma situação redefine.
    const p = await pessoa("agente-ativo");
    await prisma.membership.create({ data: { userId: p.id, organizationId: outra, role: Role.COLABORADOR } });
    await rhNaOutra(Role.RH);
    expect((await redefinir(rh.token, p.id)).status).toBe(200);
  });

  it("vínculo suspenso ou vencido na outra empresa não conta", async () => {
    await prisma.membership.deleteMany({ where: { userId: rh.user.id, organizationId: outra } });
    const suspensa = await pessoa("suspensa");
    await prisma.membership.create({
      data: { userId: suspensa.id, organizationId: outra, role: Role.COLABORADOR, suspendedAt: new Date() },
    });
    expect((await redefinir(rh.token, suspensa.id)).status).toBe(200);

    const vencida = await pessoa("vencida");
    await prisma.membership.create({
      data: {
        userId: vencida.id,
        organizationId: outra,
        role: Role.COLABORADOR,
        accessExpiresAt: new Date(Date.now() - 1000),
      },
    });
    expect((await redefinir(rh.token, vencida.id)).status).toBe(200);
  });

  it("conta só desta empresa continua como antes", async () => {
    const p = await pessoa("so-daqui");
    const res = await redefinir(rh.token, p.id);
    expect(res.status).toBe(200);
  });
});
