import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { formatCalendarDay } from "../../src/helper/calendar-day";

/**
 * O que ainda aparecia como código, ou enganava, nas telas.
 *
 * - "job_role.reorder" no Histórico do Painel, e "Status" no Inventário. [B2-1-C]
 * - "deadlineJustification: vazio" e o identificador interno da ocorrência
 *   no Histórico do risco. [B2-4-E]
 * - O exemplo do aviso em Markdown. [S3-F]
 * - "Data do evento" sem dizer que o aviso sai na hora. [S3-I]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const ACT_ID = "aaaaaaaa-0001-4000-8000-000000000014";
const SUFIXO = Date.now().toString(36);
const RAIZ = join(__dirname, "..", "..", "..");
const CLIENTE = join(RAIZ, "client", "src");
const MIGRACAO = join(RAIZ, "prisma", "migrations", "20261029000000_motivo_da_reavaliacao_legivel", "migration.sql");

const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function semComentarios(codigo: string): string {
  return codigo
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const fonte = (...c: string[]) => semComentarios(readFileSync(join(CLIENTE, ...c), "utf8")).replace(/\s+/g, " ");

let app: Express;
let sst: { token: string; user: { id: string } };
const perigos: string[] = [];

async function risco(nome: string) {
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
  return prisma.risk.create({
    data: { organizationId: ORG_ID, hazardId: perigo.id, description: `Risco ${nome} ${SUFIXO}` },
  });
}

beforeAll(async () => {
  app = createApp();
  const res = await request(app).post("/api/auth").send({ login: "teste.sst", password: "teste1234" });
  expect(res.status).toBe(200);
  sst = res.body;
});

afterAll(async () => {
  await prisma.occurrence.deleteMany({ where: { description: { contains: SUFIXO } } });
  await prisma.risk.deleteMany({ where: { hazardId: { in: perigos } } });
  await prisma.hazard.deleteMany({ where: { id: { in: perigos } } });
});

describe("o motivo da reavaliação não traz o identificador interno [B2-4-E]", () => {
  it("a análise da ocorrência grava o dia dela, não o id", async () => {
    const r = await risco("analise");
    const oc = await request(app).post("/api/occurrences").set(as(sst.token)).send({
      type: "DANGEROUS_EVENT",
      description: `Projeção de cavaco ${SUFIXO}`,
      occurred_at: "2026-09-10T14:30:00.000Z",
      establishment_id: "aaaaaaaa-0001-4000-8000-000000000011",
      risk_id: r.id,
    });
    expect(oc.status, JSON.stringify(oc.body)).toBe(201);
    const analise = await request(app)
      .post(`/api/occurrences/${oc.body.occurrence.id}/analyze`)
      .set(as(sst.token))
      .send({
        generating_situation: "Porta do torno aberta com a placa girando.",
        organizational_data: "Um operador no turno; sem relato anterior.",
        prevention_review: "Revisar o intertravamento da porta.",
      });
    expect(analise.status, JSON.stringify(analise.body)).toBe(200);

    const depois = await prisma.risk.findUniqueOrThrow({ where: { id: r.id }, select: { reassessmentReason: true } });
    expect(depois.reassessmentReason).toBe("Ocorrência de 10/09/2026 analisada — revisar medidas (1.5.5.5.2 c).");
    expect(depois.reassessmentReason).not.toMatch(UUID);
  });

  it("a migração reescreve os motivos antigos, com o dia como o servidor escreve, e pode rodar de novo", async () => {
    const casos = [
      { nome: "instante", quando: new Date("2026-09-11T01:30:00.000Z") },
      { nome: "meia-noite", quando: new Date("2026-09-20T00:00:00.000Z") },
    ];
    const ids: string[] = [];
    for (const c of casos) {
      const r = await risco(c.nome);
      const oc = await prisma.occurrence.create({
        data: {
          organizationId: ORG_ID,
          riskId: r.id,
          type: "DANGEROUS_EVENT",
          occurredAt: c.quando,
          description: `Antiga ${c.nome} ${SUFIXO}`,
          reportedById: sst.user.id,
        },
      });
      await prisma.risk.update({
        where: { id: r.id },
        data: { reassessmentReason: `Ocorrência ${oc.id} analisada — revisar medidas (1.5.5.5.2 c).` },
      });
      ids.push(r.id);
    }
    /* Ocorrência que não existe mais: o motivo fica sem o identificador. */
    const orfao = await risco("orfao");
    await prisma.risk.update({
      where: { id: orfao.id },
      data: { reassessmentReason: "Ocorrência 7c5bfa25-071a-4909-be4f-20cf9cddcc96 analisada — revisar medidas (1.5.5.5.2 c)." },
    });
    const outro = await risco("outro-motivo");
    await prisma.risk.update({ where: { id: outro.id }, data: { reassessmentReason: `Motivo escrito à mão ${SUFIXO}` } });

    /* Comando por comando, como a migração roda; duas vezes, para provar que pode repetir. */
    const comandos = readFileSync(MIGRACAO, "utf8")
      .replace(/^--.*$/gm, "")
      .split(/;\s*(?:\n|$)/)
      .map((c) => c.trim())
      .filter(Boolean);
    expect(comandos).toHaveLength(2);
    for (let vez = 0; vez < 2; vez++) {
      for (const c of comandos) await prisma.$executeRawUnsafe(c);
    }

    for (const [i, c] of casos.entries()) {
      const r = await prisma.risk.findUniqueOrThrow({ where: { id: ids[i] }, select: { reassessmentReason: true } });
      expect(r.reassessmentReason, c.nome).toBe(
        `Ocorrência de ${formatCalendarDay(c.quando)} analisada — revisar medidas (1.5.5.5.2 c).`,
      );
    }
    expect(formatCalendarDay(casos[0].quando), "instante: o dia em Brasília").toBe("10/09/2026");
    expect(formatCalendarDay(casos[1].quando), "meia-noite: o dia de calendário").toBe("20/09/2026");
    const semOcorrencia = await prisma.risk.findUniqueOrThrow({ where: { id: orfao.id }, select: { reassessmentReason: true } });
    expect(semOcorrencia.reassessmentReason).toBe("Ocorrência analisada — revisar medidas (1.5.5.5.2 c).");
    const intacto = await prisma.risk.findUniqueOrThrow({ where: { id: outro.id }, select: { reassessmentReason: true } });
    expect(intacto.reassessmentReason).toBe(`Motivo escrito à mão ${SUFIXO}`);
  });
});

describe("o Histórico do risco fala português [B2-4-E]", () => {
  /* Os rótulos e a descrição da mudança moram em lib desde a B4-A. */
  const painel = fonte("lib", "historico-do-risco.ts");

  it("a justificativa e o critério têm nome", () => {
    expect(painel).toContain('deadlineJustification: "justificativa do prazo"');
    expect(painel).toContain('effectivenessCriteria: "critério de eficácia"');
  });

  it("no registro de criação, campo vazio não aparece", () => {
    expect(painel).toContain('.filter((k) => !(before == null && (a[k] == null || a[k] === "")))');
  });
});

describe("os rótulos que faltavam [B2-1-C]", () => {
  it("a ordem das funções tem rótulo no Histórico", () => {
    expect(fonte("api", "inspection.ts")).toContain('"job_role.reorder": "Ordem das funções alterada"');
  });

  it("o Inventário diz Situação, não Status", () => {
    const inventario = fonte("pages", "InventoryPage.tsx");
    expect(inventario).not.toContain("<th>Status</th>");
    expect(inventario).toContain("<th>Situação</th>");
  });
});

describe("o aviso do mural [S3-F] [S3-I]", () => {
  const mural = fonte("pages", "AnnouncementsPage.tsx");

  it("o exemplo dentro do campo é texto comum, sem Markdown", () => {
    const exemplos = [...mural.matchAll(/placeholder=(?:"([^"]*)"|\{"([^"]*)"\})/g)].map((m) => m[1] ?? m[2]);
    expect(exemplos.length).toBeGreaterThan(0);
    for (const e of exemplos) expect(e).not.toMatch(/##|\*\*/);
  });

  it("a data do evento diz que o aviso sai na hora, ao publicar e ao corrigir", () => {
    expect(mural).toContain("O aviso sai assim que você publica.");
    expect(mural).toContain("A correção sai assim que você salva.");
  });
});
