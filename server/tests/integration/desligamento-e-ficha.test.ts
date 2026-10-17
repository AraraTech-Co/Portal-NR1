import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Registrar o desligamento — com data, motivo, autor e o acesso caindo
 * junto — e a ficha da pessoa numa tela só. [S5-H] [S6-C]
 *
 * Usa a organização do `scripts/seed-teste-org.ts`, mas desliga só gente
 * criada aqui: desligar um `teste.*` quebraria os outros testes.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const ACCOUNT_ID = "aaaaaaaa-0001-4000-8000-000000000002";
const JOB_ID = "aaaaaaaa-0001-4000-8000-000000000013";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: { token: string };
let fiscal: { token: string };
let colaborador: { token: string; user: { id: string } };
const criados: string[] = [];

const entrar = (login: string) =>
  request(app).post("/api/auth").send({ login, password: SENHA });

/** Pessoa descartável, com ficha e função do seed. */
async function novaPessoa(nome: string, role: Role = Role.COLABORADOR) {
  const login = `saida.${nome}.${SUFIXO}`;
  const user = await prisma.user.create({
    data: {
      login,
      email: `${login}@teste.local`,
      name: `Pessoa ${nome} ${SUFIXO}`,
      passwordHash: await bcrypt.hash(SENHA, 10),
      mustChangePassword: false,
    },
  });
  criados.push(user.id);
  await prisma.accountMembership.create({
    data: { accountId: ACCOUNT_ID, userId: user.id, role: AccountRole.USER },
  });
  await prisma.membership.create({
    data: { userId: user.id, organizationId: ORG_ID, role },
  });
  const profile = await prisma.employeeProfile.create({
    data: {
      organizationId: ORG_ID,
      userId: user.id,
      jobRoleId: JOB_ID,
      registration: `SAI-${nome}-${SUFIXO}`.slice(0, 20),
      admittedAt: new Date("2025-02-03T00:00:00.000Z"),
    },
  });
  return { login, userId: user.id, profileId: profile.id };
}

beforeAll(async () => {
  app = createApp();
  rh = (await entrar("teste.rh")).body;
  fiscal = (await entrar("teste.fiscal")).body;
  colaborador = (await entrar("teste.colaborador")).body;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: criados } } });
});

const desligar = (token: string, profileId: string, body: Record<string, unknown> = {}) =>
  request(app)
    .post(`/api/employee-profiles/${profileId}/desligamento`)
    .set(as(token))
    .send(body);

describe("desligamento registrado corta o acesso [S5-H]", () => {
  it("grava data, motivo e autor, e derruba a sessão aberta", async () => {
    const p = await novaPessoa("ana");
    const sessao = (await entrar(p.login)).body.token as string;
    expect((await request(app).get("/api/auth").set(as(sessao))).status).toBe(200);

    const res = await desligar(rh.token, p.profileId, {
      dismissed_at: "2026-10-10",
      reason: "Pedido de demissão",
    });
    expect(res.status).toBe(200);
    expect(res.body.profile.dismissalReason).toBe("Pedido de demissão");
    expect(res.body.profile.dismissedBy.name).toBeTruthy();
    expect(String(res.body.profile.dismissedAt).slice(0, 10)).toBe("2026-10-10");
    expect(res.body.access_revoked).toBe(true);

    // Sessão que já estava aberta não sobrevive.
    expect((await request(app).get("/api/auth").set(as(sessao))).status).toBe(401);
    // E não entra de novo — com recado, sem dizer que foi desligamento.
    // A recusa passou a dizer o que é: desligamento não se "renova". [CB-39]
    const tentativa = await entrar(p.login);
    expect(tentativa.status).toBe(403);
    expect(tentativa.body.code).toBe("ACCESS_DISMISSED");
  });

  it("não aceita desligamento no futuro nem antes da admissão", async () => {
    const p = await novaPessoa("bruno");
    const amanha = new Date(Date.now() + 36 * 3_600_000).toISOString().slice(0, 10);

    const futuro = await desligar(rh.token, p.profileId, { dismissed_at: amanha });
    expect(futuro.status).toBe(400);
    expect(futuro.body.message).toMatch(/futuro/i);

    const antesDaAdmissao = await desligar(rh.token, p.profileId, {
      dismissed_at: "2024-01-01",
    });
    expect(antesDaAdmissao.status).toBe(400);
    expect(antesDaAdmissao.body.message).toMatch(/admiss/i);
  });

  it("sem data, vale hoje; desligar duas vezes não passa", async () => {
    const p = await novaPessoa("carla");
    const primeira = await desligar(rh.token, p.profileId);
    expect(primeira.status).toBe(200);
    expect(primeira.body.profile.dismissedAt).toBeTruthy();

    const segunda = await desligar(rh.token, p.profileId);
    expect(segunda.status).toBe(404);
  });

  it("reverter devolve o acesso e limpa o motivo", async () => {
    const p = await novaPessoa("davi");
    await desligar(rh.token, p.profileId, { reason: "Engano" });
    expect((await entrar(p.login)).status).toBe(403);

    const volta = await request(app)
      .post(`/api/employee-profiles/${p.profileId}/reverter-desligamento`)
      .set(as(rh.token));
    expect(volta.status).toBe(200);
    expect(volta.body.profile.dismissedAt).toBeNull();
    expect(volta.body.profile.dismissalReason).toBeNull();

    expect((await entrar(p.login)).status).toBe(200);
  });

  it("reverter devolve o acesso sem mexer no prazo de quem só entra com prazo", async () => {
    const p = await novaPessoa("eva", Role.FISCAL);
    const ate = new Date(Date.now() + 10 * 24 * 3_600_000);
    await prisma.membership.updateMany({
      where: { userId: p.userId, organizationId: ORG_ID },
      data: { accessExpiresAt: ate },
    });

    await desligar(rh.token, p.profileId);
    expect((await entrar(p.login)).status).toBe(403);

    await request(app)
      .post(`/api/employee-profiles/${p.profileId}/reverter-desligamento`)
      .set(as(rh.token));

    /*
      O desligamento passou a ter campo próprio: reverter solta a suspensão e
      o prazo do fiscal continua de pé, intacto. Antes os dois dividiam o
      mesmo campo e o fiscal ficava trancado para sempre. [CB-39]
    */
    const membership = await prisma.membership.findFirst({
      where: { userId: p.userId, organizationId: ORG_ID },
      select: { accessExpiresAt: true, suspendedAt: true },
    });
    expect(membership?.suspendedAt).toBeNull();
    expect(membership?.accessExpiresAt?.getTime()).toBe(ate.getTime());
    expect((await entrar(p.login)).status).toBe(200);
  });

  it("quem não cuida de colaboradores não desliga ninguém", async () => {
    const p = await novaPessoa("fabio");
    expect((await desligar(colaborador.token, p.profileId)).status).toBe(403);
    expect((await desligar(fiscal.token, p.profileId)).status).toBe(403);
  });
});

describe("a ficha da pessoa [S6-C]", () => {
  it("traz cadastro, vínculo, o que a função exige, ordem de serviço e histórico", async () => {
    const p = await novaPessoa("gabi");
    await request(app)
      .patch(`/api/employee-profiles/${p.profileId}`)
      .set(as(rh.token))
      .send({ phone: "19999990000" });

    const res = await request(app)
      .get(`/api/employee-profiles/${p.profileId}/ficha`)
      .set(as(rh.token));
    expect(res.status).toBe(200);

    expect(res.body.profile.user.name).toContain("Pessoa gabi");
    expect(res.body.profile.jobRole.sector.establishment.name).toBeTruthy();
    expect(res.body.membership.role).toBe("COLABORADOR");
    expect(res.body.membership.access_active).toBe(true);

    // A exigência da função do seed aparece, e sem comprovante ela é lacuna.
    const exigencias = res.body.requirements as { name: string; status: string }[];
    expect(exigencias.length).toBeGreaterThan(0);
    expect(exigencias.every((q) => ["ok", "missing", "expired", "pending", "rejected"].includes(q.status))).toBe(true);
    expect(exigencias.some((q) => q.status === "missing")).toBe(true);

    expect(Array.isArray(res.body.history)).toBe(true);
    expect((res.body.history as { action: string }[]).some((h) => h.action === "employee_profile.update")).toBe(true);
  });

  it("a ficha mostra o desligamento com quem registrou", async () => {
    const p = await novaPessoa("heitor");
    await desligar(rh.token, p.profileId, { reason: "Fim de contrato" });

    const res = await request(app)
      .get(`/api/employee-profiles/${p.profileId}/ficha`)
      .set(as(rh.token));
    expect(res.status).toBe(200);
    expect(res.body.profile.dismissalReason).toBe("Fim de contrato");
    expect(res.body.profile.dismissedBy.name).toBeTruthy();
    expect(res.body.membership.access_active).toBe(false);
    expect(
      (res.body.history as { action: string }[]).some(
        (h) => h.action === "employee_profile.dismiss",
      ),
    ).toBe(true);
  });

  it("a própria ficha sempre; a do colega, não", async () => {
    const minha = await prisma.employeeProfile.findFirst({
      where: { organizationId: ORG_ID, userId: colaborador.user.id },
      select: { id: true },
    });
    expect(minha).toBeTruthy();

    const propria = await request(app)
      .get(`/api/employee-profiles/${minha!.id}/ficha`)
      .set(as(colaborador.token));
    expect(propria.status).toBe(200);

    const p = await novaPessoa("ivo");
    const doColega = await request(app)
      .get(`/api/employee-profiles/${p.profileId}/ficha`)
      .set(as(colaborador.token));
    expect(doColega.status).toBe(403);
  });

  it("o fiscal vê a ficha sem CPF nem telefone", async () => {
    const p = await novaPessoa("julia");
    await request(app)
      .patch(`/api/employee-profiles/${p.profileId}`)
      .set(as(rh.token))
      .send({ phone: "19988887777", tax_id: "12345678909" });

    const paraORh = await request(app)
      .get(`/api/employee-profiles/${p.profileId}/ficha`)
      .set(as(rh.token));
    expect(paraORh.body.profile.phone).toBe("19988887777");

    const paraOFiscal = await request(app)
      .get(`/api/employee-profiles/${p.profileId}/ficha`)
      .set(as(fiscal.token));
    expect(paraOFiscal.status).toBe(200);
    expect(paraOFiscal.body.profile.taxId).toBeNull();
    expect(paraOFiscal.body.profile.phone).toBeNull();
  });
});
