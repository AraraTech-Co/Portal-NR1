import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O Inventário diz que há reavaliação aguardando validação.
 *
 * O prazo da ação já segue a avaliação mais recente, validada ou não
 * [B3-2-A], mas o Inventário mostrava só o nível validado: quem reavaliava
 * não via ali que o nível ia mudar.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const ACT_ID = "aaaaaaaa-0001-4000-8000-000000000014";
const SUFIXO = Date.now().toString(36);

let app: Express;
let sst: { token: string; user: { id: string } };
const perigos: string[] = [];

async function riscoCom(nome: string, avaliacoes: Array<{ nivel: string; status: "VALIDATED" | "DRAFT" }>) {
  const perigo = await prisma.hazard.create({
    data: {
      organizationId: ORG_ID,
      activityId: ACT_ID,
      description: `Perigo ${nome} ${SUFIXO}`,
      category: "ACCIDENT",
      status: "IDENTIFIED",
      origin: "ROUTINE_REVIEW",
      createdById: sst.user.id,
    },
  });
  perigos.push(perigo.id);
  const risco = await prisma.risk.create({
    data: { organizationId: ORG_ID, hazardId: perigo.id, description: `Risco ${nome} ${SUFIXO}` },
  });
  const versao = await prisma.riskMethodologyVersion.findFirstOrThrow({ select: { id: true } });
  for (const [i, a] of avaliacoes.entries()) {
    await prisma.riskAssessment.create({
      data: {
        organizationId: ORG_ID,
        riskId: risco.id,
        methodologyVersionId: versao.id,
        severity: 3,
        probability: 3,
        resultingLevel: a.nivel,
        status: a.status,
        assessorId: sst.user.id,
        assessedAt: new Date(Date.now() - (avaliacoes.length - i) * 60_000),
        ...(a.status === "VALIDATED" ? { validatedById: sst.user.id, validatedAt: new Date() } : {}),
      },
    });
  }
  return risco.id;
}

async function noInventario(riskId: string) {
  const res = await request(app)
    .get("/api/inventory")
    .set({ Authorization: `Bearer ${sst.token}` });
  expect(res.status).toBe(200);
  for (const item of res.body.inventory.items as Array<{ risks: Array<{ risk_id: string; level: string | null; pending_level: string | null }> }>) {
    const r = item.risks.find((x) => x.risk_id === riskId);
    if (r) return r;
  }
  throw new Error("risco fora do inventário");
}

beforeAll(async () => {
  app = createApp();
  const res = await request(app).post("/api/auth").send({ login: "teste.sst", password: "teste1234" });
  expect(res.status).toBe(200);
  sst = res.body;
});

afterAll(async () => {
  const riscos = await prisma.risk.findMany({ where: { hazardId: { in: perigos } }, select: { id: true } });
  await prisma.riskAssessment.deleteMany({ where: { riskId: { in: riscos.map((r) => r.id) } } });
  await prisma.risk.deleteMany({ where: { hazardId: { in: perigos } } });
  await prisma.hazard.deleteMany({ where: { id: { in: perigos } } });
});

describe("o nível no Inventário [B3-2-A]", () => {
  it("validada e reavaliação aguardando: vale a validada, e a outra vem como pendente", async () => {
    const id = await riscoCom("dois", [
      { nivel: "SUBSTANTIAL", status: "VALIDATED" },
      { nivel: "TOLERABLE", status: "DRAFT" },
    ]);
    expect(await noInventario(id)).toMatchObject({ level: "SUBSTANTIAL", pending_level: "TOLERABLE" });
  }, 30_000);

  it("só a avaliação aguardando: sem nível validado, com o pendente", async () => {
    const id = await riscoCom("so-pendente", [{ nivel: "MODERATE", status: "DRAFT" }]);
    expect(await noInventario(id)).toMatchObject({ level: null, pending_level: "MODERATE" });
  }, 30_000);

  it("sem nada aguardando: nenhum pendente", async () => {
    const id = await riscoCom("validada", [{ nivel: "INTOLERABLE", status: "VALIDATED" }]);
    expect(await noInventario(id)).toMatchObject({ level: "INTOLERABLE", pending_level: null });
  }, 30_000);

  it("a tela mostra o pendente embaixo do nível", () => {
    const tela = readFileSync(join(__dirname, "..", "..", "..", "client", "src", "pages", "InventoryPage.tsx"), "utf8")
      .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, " ")
      .replace(/\s+/g, " ");
    expect(tela).toContain("pendingLevel: risk.pending_level ?? null,");
    expect(tela).toMatch(/\{row\.pendingLevel && row\.pendingLevel !== row\.level && \( <div className="muted inventory-pendente"> aguardando validação:\{" "\} \{LEVEL_LABEL\[row\.pendingLevel\] \?\? row\.pendingLevel\}/);
    expect(tela).toContain('{row.pendingLevel ? "Sem avaliação validada" : "Sem avaliação"}');
  });
});
