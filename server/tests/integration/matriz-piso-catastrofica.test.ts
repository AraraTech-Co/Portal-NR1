import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { defaultMethodologyVersion } from "../../../prisma/matriz-padrao";

/**
 * Severidade 5 (Catastrófica) nunca fica abaixo de Moderado na matriz padrão.
 * [P2]
 *
 * A mudança é uma versão nova da metodologia global: as avaliações antigas
 * continuam com a versão que usaram, e os riscos avaliados em severidade 5
 * abaixo de Moderado ficam marcados para reavaliar.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG = "aaaaaaaa-0001-4000-8000-000000000001";
const ACT_ID = "aaaaaaaa-0001-4000-8000-000000000014";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
const BAIXOS = ["TRIVIAL", "TOLERABLE"];

const MIGRACAO = readFileSync(
  join(__dirname, "../../../prisma/migrations/20261031000000_matriz_piso_catastrofica/migration.sql"),
  "utf8",
);

async function entrar(app: Express, login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

/** A matriz 5×5 como era antes do piso: severidade × probabilidade em faixas. */
function matrizAntiga() {
  const m: Record<string, string> = {};
  for (let s = 1; s <= 5; s++)
    for (let p = 1; p <= 5; p++) {
      const n = s * p;
      m[`${s}-${p}`] =
        n <= 2 ? "TRIVIAL" : n <= 5 ? "TOLERABLE" : n <= 10 ? "MODERATE" : n <= 15 ? "SUBSTANTIAL" : "INTOLERABLE";
    }
  return m;
}

let app: Express;
let sst: { token: string; user: { id: string } };

beforeAll(async () => {
  app = createApp();
  sst = await entrar(app, "teste.sst");
});

describe("a matriz padrão vigente", () => {
  it("dá no mínimo Moderado em toda a severidade 5, e só a linha 5 muda", async () => {
    const res = await request(app).get("/api/methodologies").set(as(sst.token));
    const padrao = (res.body.methodologies as {
      id: string;
      isDefault: boolean;
      organizationId: string | null;
      versions: { version: number; matrix: Record<string, string> }[];
    }[]).find((m) => m.isDefault && m.organizationId === null)!;
    const vigente = padrao.versions[0]!;

    expect(vigente.matrix["5-1"]).toBe("MODERATE");
    for (let p = 1; p <= 5; p++) expect(BAIXOS).not.toContain(vigente.matrix[`5-${p}`]);

    const antiga = matrizAntiga();
    for (const [casa, nivel] of Object.entries(vigente.matrix)) {
      if (!casa.startsWith("5-")) expect(nivel, casa).toBe(antiga[casa]);
    }
  });

  it("avaliar 5 × 1 pela matriz vigente dá Moderado", async () => {
    const metodologias = (await request(app).get("/api/methodologies").set(as(sst.token))).body
      .methodologies as { isDefault: boolean; versions: { id: string }[] }[];
    const versao = (metodologias.find((m) => m.isDefault) ?? metodologias[0]!).versions[0]!.id;

    const perigo = await prisma.hazard.create({
      data: {
        organizationId: ORG,
        activityId: ACT_ID,
        description: `Perigo catastrófico ${SUFIXO}`,
        category: "ACCIDENT",
        status: "IDENTIFIED",
        origin: "ROUTINE_REVIEW",
        createdById: sst.user.id,
      },
    });
    try {
      const risco = await prisma.risk.create({
        data: { organizationId: ORG, hazardId: perigo.id, description: `Risco catastrófico ${SUFIXO}` },
      });
      const res = await request(app).post("/api/assessments").set(as(sst.token)).send({
        risk_id: risco.id,
        methodology_version_id: versao,
        severity: 5,
        probability: 1,
      });
      expect(res.status).toBe(201);
      expect(res.body.assessment.resultingLevel).toBe("MODERATE");
    } finally {
      await prisma.riskAssessment.deleteMany({ where: { risk: { hazardId: perigo.id } } });
      await prisma.risk.deleteMany({ where: { hazardId: perigo.id } });
      await prisma.hazard.delete({ where: { id: perigo.id } });
    }
  });
});

describe("a matriz que o seed cria num banco novo", () => {
  it("já vem com o piso: só as casas baixas da severidade 5 diferem da antiga", () => {
    const { matrix } = defaultMethodologyVersion();
    const antiga = matrizAntiga();
    expect(Object.keys(matrix).sort()).toEqual(Object.keys(antiga).sort());
    for (const [casa, nivel] of Object.entries(antiga)) {
      const esperado = casa.startsWith("5-") && BAIXOS.includes(nivel) ? "MODERATE" : nivel;
      expect(matrix[casa], casa).toBe(esperado);
    }
  });
});

describe("a migração, num banco que ainda tem a matriz antiga", () => {
  /*
    A migração roda dentro de uma transação desfeita no fim: os dados criados
    aqui e o que ela grava nunca chegam aos outros testes.
  */
  const DESFAZER = new Error("desfazer");

  it("cria a versão nova só da metodologia global e marca só os riscos certos", async () => {
    let conferido = false;
    await prisma
      .$transaction(
        async (tx) => {
          const global = await tx.riskMethodology.create({
            data: { organizationId: null, name: `Global ${SUFIXO}`, isDefault: false },
          });
          const propria = await tx.riskMethodology.create({
            data: { organizationId: ORG, name: `Própria ${SUFIXO}`, isDefault: false },
          });
          const escalas = {
            severityScale: [1, 2, 3, 4, 5].map((value) => ({ value, label: `S${value}` })),
            probabilityScale: [1, 2, 3, 4, 5].map((value) => ({ value, label: `P${value}` })),
            levels: [],
          };
          const vGlobal = await tx.riskMethodologyVersion.create({
            data: { methodologyId: global.id, version: 1, matrix: matrizAntiga(), ...escalas },
          });
          const vPropria = await tx.riskMethodologyVersion.create({
            data: { methodologyId: propria.id, version: 1, matrix: matrizAntiga(), ...escalas },
          });

          const perigo = await tx.hazard.create({
            data: {
              organizationId: ORG,
              activityId: ACT_ID,
              description: `Perigo da migração ${SUFIXO}`,
              category: "ACCIDENT",
              status: "IDENTIFIED",
              origin: "ROUTINE_REVIEW",
              createdById: sst.user.id,
            },
          });
          const risco = async (
            nome: string,
            versao: string,
            severity: number,
            probability: number,
            resultingLevel: string,
            status: "DRAFT" | "VALIDATED" | "SUPERSEDED",
            extra: { archivedAt?: Date; needsReassessment?: boolean; reassessmentReason?: string } = {},
          ) => {
            const r = await tx.risk.create({
              data: { organizationId: ORG, hazardId: perigo.id, description: `${nome} ${SUFIXO}`, ...extra },
            });
            await tx.riskAssessment.create({
              data: {
                organizationId: ORG,
                riskId: r.id,
                methodologyVersionId: versao,
                severity,
                probability,
                resultingLevel,
                status,
                assessorId: sst.user.id,
              },
            });
            return r.id;
          };
          const catastroficoValidado = await risco("A", vGlobal.id, 5, 1, "TOLERABLE", "VALIDATED");
          const catastroficoRascunho = await risco("B", vGlobal.id, 5, 1, "TOLERABLE", "DRAFT");
          const graveTolerável = await risco("C", vGlobal.id, 4, 1, "TOLERABLE", "VALIDATED");
          const daPropria = await risco("D", vPropria.id, 5, 1, "TOLERABLE", "VALIDATED");
          const jaMarcado = await risco("E", vGlobal.id, 5, 1, "TOLERABLE", "VALIDATED", {
            needsReassessment: true,
            reassessmentReason: "Outro motivo",
          });
          const substituida = await risco("F", vGlobal.id, 5, 1, "TOLERABLE", "SUPERSEDED");
          const arquivado = await risco("G", vGlobal.id, 5, 1, "TOLERABLE", "VALIDATED", {
            archivedAt: new Date(),
          });
          const jaModerado = await risco("H", vGlobal.id, 5, 2, "MODERATE", "VALIDATED");

          await tx.$executeRawUnsafe(MIGRACAO);
          await tx.$executeRawUnsafe(MIGRACAO);

          const versoesGlobal = await tx.riskMethodologyVersion.findMany({
            where: { methodologyId: global.id },
            orderBy: { version: "asc" },
          });
          expect(versoesGlobal.map((v) => v.version), "uma versão nova, mesmo rodando duas vezes").toEqual([1, 2]);
          const nova = versoesGlobal[1]!.matrix as Record<string, string>;
          const antiga = matrizAntiga();
          for (const [casa, nivel] of Object.entries(antiga)) {
            const esperado = casa.startsWith("5-") && BAIXOS.includes(nivel) ? "MODERATE" : nivel;
            expect(nova[casa], casa).toBe(esperado);
          }
          expect(versoesGlobal[0]!.matrix, "a versão antiga fica como era").toEqual(antiga);
          expect(versoesGlobal[1]!.severityScale).toEqual(escalas.severityScale);

          expect(await tx.riskMethodologyVersion.count({ where: { methodologyId: propria.id } })).toBe(1);

          const marca = async (id: string) =>
            tx.risk.findUniqueOrThrow({
              where: { id },
              select: { needsReassessment: true, reassessmentReason: true },
            });
          expect(await marca(catastroficoValidado)).toEqual({
            needsReassessment: true,
            reassessmentReason: expect.stringMatching(/matriz padrão mudou/),
          });
          expect((await marca(catastroficoRascunho)).needsReassessment).toBe(true);
          expect((await marca(graveTolerável)).needsReassessment).toBe(false);
          expect((await marca(daPropria)).needsReassessment).toBe(false);
          expect(await marca(jaMarcado)).toEqual({
            needsReassessment: true,
            reassessmentReason: "Outro motivo",
          });
          expect((await marca(substituida)).needsReassessment).toBe(false);
          expect((await marca(arquivado)).needsReassessment).toBe(false);
          expect((await marca(jaModerado)).needsReassessment).toBe(false);
          conferido = true;
          throw DESFAZER;
        },
        { timeout: 60_000 },
      )
      .catch((e) => {
        if (e !== DESFAZER) throw e;
      });
    expect(conferido).toBe(true);
  });
});
