import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Os responsáveis da emergência ficam ligados ao cadastro de pessoas.
 *
 * Gravados como texto, os responsáveis do procedimento ficavam sem ligação
 * com as pessoas: se um deles fosse desligado, o plano continuava com o nome
 * dele, sem aviso. O texto fica para quem é de fora da empresa. [B3-4-B]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const EST_ID = "aaaaaaaa-0001-4000-8000-000000000011";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let sst: { token: string; user: { id: string } };
let rh: { token: string };
const pessoas: string[] = [];
const procedimentos: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: "teste1234" });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body;
}

async function pessoa(nome: string) {
  const login = `brigada.${nome}.${SUFIXO}`;
  const u = await prisma.user.create({
    data: { login, email: `${login}@teste.local`, name: `Brigadista ${nome} ${SUFIXO}`, passwordHash: await bcrypt.hash("x", 4) },
  });
  pessoas.push(u.id);
  await prisma.membership.create({ data: { userId: u.id, organizationId: ORG_ID, role: Role.COLABORADOR } });
  const ficha = await prisma.employeeProfile.create({
    data: { organizationId: ORG_ID, userId: u.id, admittedAt: new Date("2025-01-10T00:00:00Z") },
  });
  return { id: u.id, fichaId: ficha.id };
}

const criar = (corpo: Record<string, unknown>) =>
  request(app)
    .post("/api/emergency-procedures")
    .set(as(sst.token))
    .send({
      establishment_id: EST_ID,
      scenario: `Incêndio na usinagem ${SUFIXO}`,
      first_aid_means: "Kit e lava-olhos",
      evacuation_plan: "Portão lateral",
      ...corpo,
    });

beforeAll(async () => {
  app = createApp();
  sst = await entrar("teste.sst");
  rh = await entrar("teste.rh");
});

afterAll(async () => {
  await prisma.emergencyProcedure.deleteMany({ where: { id: { in: procedimentos } } });
  await prisma.user.deleteMany({ where: { id: { in: pessoas } } });
});

describe("responsáveis ligados ao cadastro [B3-4-B]", () => {
  it("o plano grava as pessoas da empresa, e o texto fica para quem é de fora", async () => {
    const a = await pessoa("ana");
    const res = await criar({ responsible_user_ids: [a.id], responsibles: "Bombeiros civis da terceirizada" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    procedimentos.push(res.body.procedure.id);

    const det = await request(app).get(`/api/emergency-procedures/${res.body.procedure.id}`).set(as(sst.token));
    expect(det.body.procedure.responsible_people).toEqual([
      { id: a.id, name: `Brigadista ana ${SUFIXO}`, situacao: "ativo", desde: null },
    ]);
    expect(det.body.procedure.responsibles).toBe("Bombeiros civis da terceirizada");
  });

  it("só pessoas, sem texto, também vale; sem nenhum dos dois, não", async () => {
    const b = await pessoa("bia");
    const so = await criar({ responsible_user_ids: [b.id] });
    expect(so.status, JSON.stringify(so.body)).toBe(201);
    procedimentos.push(so.body.procedure.id);

    const nada = await criar({ responsible_user_ids: [] });
    expect(nada.status).toBe(400);
    expect(nada.body.message).toMatch(/responsáveis/);
  });

  it("quem já foi desligado não entra como responsável", async () => {
    const c = await pessoa("caio");
    await prisma.membership.updateMany({
      where: { userId: c.id, organizationId: ORG_ID },
      data: { suspendedAt: new Date(), suspensionReason: "DISMISSAL" },
    });
    const res = await criar({ responsible_user_ids: [c.id] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("RESPONSIBLE_NOT_ACTIVE");
  });

  it("pessoa de outra empresa não entra", async () => {
    const outra = await prisma.membership.findFirstOrThrow({
      where: { organizationId: { not: ORG_ID } },
      select: { userId: true },
    });
    const dupla = await prisma.membership.findFirst({ where: { userId: outra.userId, organizationId: ORG_ID } });
    if (dupla) return;
    const res = await criar({ responsible_user_ids: [outra.userId] });
    expect(res.status).toBe(400);
  });

  it("quando o responsável é desligado, o plano avisa no detalhe e na lista", async () => {
    const d = await pessoa("davi");
    const res = await criar({ responsible_user_ids: [d.id] });
    expect(res.status).toBe(201);
    const id = res.body.procedure.id as string;
    procedimentos.push(id);

    const deslig = await request(app)
      .post(`/api/employee-profiles/${d.fichaId}/desligamento`)
      .set(as(rh.token))
      .send({ dismissed_at: "2026-10-20", reason: "Pedido de demissão" });
    expect(deslig.status, JSON.stringify(deslig.body)).toBe(200);

    const det = await request(app).get(`/api/emergency-procedures/${id}`).set(as(sst.token));
    expect(det.body.procedure.responsible_people[0]).toMatchObject({
      id: d.id,
      situacao: "desligado",
      desde: "2026-10-20T00:00:00.000Z",
    });

    const lista = await request(app).get("/api/emergency-procedures").set(as(sst.token));
    const linha = (lista.body.procedures as Array<{ id: string; responsibles_out: number }>).find((p) => p.id === id);
    expect(linha?.responsibles_out).toBe(1);
  });

  it("trocar os responsáveis pela edição substitui a lista", async () => {
    const e = await pessoa("eva");
    const f = await pessoa("fabio");
    const res = await criar({ responsible_user_ids: [e.id] });
    const id = res.body.procedure.id as string;
    procedimentos.push(id);
    const editar = await request(app)
      .patch(`/api/emergency-procedures/${id}`)
      .set(as(sst.token))
      .send({ responsible_user_ids: [f.id] });
    expect(editar.status, JSON.stringify(editar.body)).toBe(200);
    const det = await request(app).get(`/api/emergency-procedures/${id}`).set(as(sst.token));
    expect(det.body.procedure.responsible_people.map((p: { id: string }) => p.id)).toEqual([f.id]);

    const esvaziar = await request(app)
      .patch(`/api/emergency-procedures/${id}`)
      .set(as(sst.token))
      .send({ responsible_user_ids: [] });
    expect(esvaziar.status, "sem pessoa e sem texto, o plano fica sem responsável").toBe(400);
  });
});

describe("a tela [B3-4-B]", () => {
  const tela = readFileSync(join(__dirname, "..", "..", "..", "client", "src", "pages", "EmergenciesPage.tsx"), "utf8")
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, " ")
    .replace(/\s+/g, " ");

  it("envia as pessoas escolhidas, não os nomes delas num texto", () => {
    expect(tela).toContain("responsibleUserIds: responsibleIds,");
    expect(tela).toContain("responsibles: responsiblesExtra.trim() || undefined,");
    expect(tela).not.toContain("responsibleMembers.map((m) => m.name)");
  });

  it("marca quem saiu, no detalhe e na lista", () => {
    expect(tela).toMatch(/\{pessoa\.situacao !== "ativo" && \(/);
    expect(tela).toContain("— escolha outra pessoa para o plano.");
    expect(tela).toMatch(/\{\(p\.responsibles_out \?\? 0\) > 0 && \(/);
  });
});
