import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { nivelParaPrazo } from "../../../client/src/lib/labels";

/**
 * O limite do prazo usa a avaliação mais recente, mesmo à espera de
 * validação.
 *
 * Decisão B3-2-A: a sugestão e o limite de prazo saem do nível da última
 * avaliação, validada ou não, e a tela diz de onde vem ("Substancial,
 * aguardando validação → Alta → até 30 dias"). Nunca mais "Sem risco
 * avaliado" para risco já avaliado. Se a validação mudar o nível, quem abriu
 * a ação é avisado. [B3-2-A]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
const CLIENTE = join(__dirname, "..", "..", "..", "client", "src");

type Sessao = { token: string; user: { id: string } };
let app: Express;
let sst: Sessao;
let owner: Sessao;
let supervisor: Sessao;
let metodologia: string;
const riscos: string[] = [];
const acoes: string[] = [];

const as = (s: Sessao) => ({ Authorization: `Bearer ${s.token}` });

async function entrar(login: string): Promise<Sessao> {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as Sessao;
}

function emDias(dias: number): string {
  return new Date(Date.now() - 3 * 3_600_000 + dias * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Um risco sem avaliação, pelas rotas da tela. */
async function risco(nome: string) {
  const est = (
    await request(app)
      .post("/api/establishments")
      .set(as(sst))
      .send({ name: `${nome} ${SUFIXO}` })
  ).body.establishment;
  const setor = (
    await request(app)
      .post("/api/sectors")
      .set(as(sst))
      .send({ establishment_id: est.id, name: "Usinagem" })
  ).body.sector;
  const atividade = (
    await request(app).post("/api/activities").set(as(sst)).send({
      establishment_id: est.id,
      sector_id: setor.id,
      name: `Tornear ${nome} ${SUFIXO}`,
      description: "Opera o torno convencional",
    })
  ).body.activity;
  const perigo = (
    await request(app).post("/api/hazards").set(as(sst)).send({
      activity_id: atividade.id,
      description: `Placa girando ${nome} ${SUFIXO}`,
      category: "ACCIDENT",
    })
  ).body.hazard;
  const r = (
    await request(app)
      .post("/api/risks")
      .set(as(sst))
      .send({ hazard_id: perigo.id, description: `Aprisionamento ${nome} ${SUFIXO}` })
  ).body.risk;
  riscos.push(r.id);
  return r.id as string;
}

/** Avaliação gravada direto, no estado pedido: o caminho dela tem teste próprio. */
async function avaliacao(
  riskId: string,
  nivel: string,
  status: "DRAFT" | "VALIDATED" | "SUPERSEDED",
  minutosAtras: number,
) {
  const a = await prisma.riskAssessment.create({
    data: {
      organizationId: ORG_ID,
      riskId,
      methodologyVersionId: metodologia,
      severity: 4,
      probability: 4,
      resultingLevel: nivel,
      status,
      assessorId: sst.user.id,
      assessedAt: new Date(Date.now() - minutosAtras * 60_000),
      ...(status === "VALIDATED"
        ? { validatedById: owner.user.id, validatedAt: new Date() }
        : {}),
    },
  });
  return a.id;
}

async function abrirAcao(quem: Sessao, riskId: string, dias: number, extra = {}) {
  const res = await request(app)
    .post("/api/actions")
    .set(as(quem))
    .send({
      title: `Proteção da placa ${SUFIXO}`,
      risk_id: riskId,
      priority: "HIGH",
      assignee_id: supervisor.user.id,
      due_date: emDias(dias),
      effectiveness_criteria: "Máquina não liga com a proteção aberta",
      ...extra,
    });
  if (res.status === 201) acoes.push(res.body.action.id);
  return res;
}

/** O mesmo formato de `rotulos-de-auditoria.test.ts`: bloco, depois linha. */
function semComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const fonte = (...c: string[]) =>
  semComentarios(readFileSync(join(CLIENTE, ...c), "utf8"));
const plano = (t: string) => t.replace(/\s+/g, " ");

beforeAll(async () => {
  app = createApp();
  sst = await entrar("teste.sst");
  owner = await entrar("teste.owner");
  supervisor = await entrar("teste.supervisor");
  metodologia = (
    await prisma.riskMethodologyVersion.findFirstOrThrow({
      orderBy: { createdAt: "desc" },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { entityId: { in: acoes } } });
  await prisma.action.deleteMany({ where: { id: { in: acoes } } });
  await prisma.riskAssessment.deleteMany({ where: { riskId: { in: riscos } } });
});

describe("o limite sai da avaliação mais recente [B3-2-A]", () => {
  it("avaliada como Substancial e ainda sem validação: 90 dias pedem justificativa", async () => {
    const r = await risco("Rascunho");
    await avaliacao(r, "SUBSTANTIAL", "DRAFT", 1);
    const res = await abrirAcao(sst, r, 90);
    expect(res.status, "aceitava qualquer prazo logo depois de avaliar").toBe(400);
    expect(res.body.code).toBe("DEADLINE_NEEDS_JUSTIFICATION");
    expect(res.body.limit_days).toBe(30);
    expect(res.body.message).toContain("Substancial, aguardando validação,");
  });

  it("dentro do limite, abre — e a ação guarda o nível com que nasceu", async () => {
    const r = await risco("Dentro");
    await avaliacao(r, "SUBSTANTIAL", "DRAFT", 1);
    const res = await abrirAcao(sst, r, 20);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const a = await prisma.action.findUniqueOrThrow({
      where: { id: res.body.action.id },
      select: { riskLevelAtOpening: true },
    });
    expect(a.riskLevelAtOpening).toBe("SUBSTANTIAL");
  });

  it("a mais recente vence a validada mais antiga", async () => {
    const r = await risco("Recente");
    await avaliacao(r, "MODERATE", "VALIDATED", 60);
    await avaliacao(r, "INTOLERABLE", "DRAFT", 1);
    const res = await abrirAcao(sst, r, 20);
    expect(res.status).toBe(400);
    expect(res.body.limit_days, "Intolerável pede 7 dias").toBe(7);
  });

  it("a avaliação substituída não conta, mesmo sendo a mais nova", async () => {
    const r = await risco("Substituida");
    await avaliacao(r, "MODERATE", "VALIDATED", 60);
    await avaliacao(r, "INTOLERABLE", "SUPERSEDED", 1);
    const res = await abrirAcao(sst, r, 120);
    expect(res.status).toBe(400);
    expect(res.body.limit_days, "Moderado pede 90 dias").toBe(90);
  });

  it("validada, a mensagem não fala em validação pendente", async () => {
    const r = await risco("Validada");
    await avaliacao(r, "SUBSTANTIAL", "VALIDATED", 1);
    const res = await abrirAcao(sst, r, 90);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/^Risco Substancial pede prazo/);
  });

  it("sem avaliação nenhuma, segue sem limite", async () => {
    const r = await risco("Sem");
    const res = await abrirAcao(sst, r, 200);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const a = await prisma.action.findUniqueOrThrow({
      where: { id: res.body.action.id },
      select: { riskLevelAtOpening: true },
    });
    expect(a.riskLevelAtOpening).toBeNull();
  });
});

describe("a validação que muda o nível avisa quem abriu a ação [B3-2-A]", () => {
  const avisos = (userId: string, actionId: string) =>
    prisma.notification.findMany({
      where: { userId, entityId: actionId, kind: "ACTION_RISK_LEVEL_CHANGED" },
      select: { body: true, link: true },
    });

  it("aberta com Substancial, validada como Moderado: quem abriu é avisado", async () => {
    const r = await risco("Muda");
    await avaliacao(r, "SUBSTANTIAL", "DRAFT", 10);
    const acao = await abrirAcao(sst, r, 20);
    expect(acao.status).toBe(201);
    // O técnico reconsiderou: nova avaliação, e é esta que o owner valida.
    const nova = await avaliacao(r, "MODERATE", "DRAFT", 1);
    const val = await request(app).post(`/api/assessments/${nova}/validate`).set(as(owner));
    expect(val.status, JSON.stringify(val.body)).toBe(200);

    const lista = await avisos(sst.user.id, acao.body.action.id);
    expect(lista.length).toBe(1);
    expect(lista[0]!.body).toContain("Substancial");
    expect(lista[0]!.body).toContain("Moderado");
    expect(lista[0]!.link).toBe("/acoes");
  });

  it("validada no mesmo nível: ninguém é avisado", async () => {
    const r = await risco("Igual");
    const rascunho = await avaliacao(r, "SUBSTANTIAL", "DRAFT", 10);
    const acao = await abrirAcao(sst, r, 20);
    const val = await request(app)
      .post(`/api/assessments/${rascunho}/validate`)
      .set(as(owner));
    expect(val.status).toBe(200);
    expect(await avisos(sst.user.id, acao.body.action.id)).toEqual([]);
  });

  it("quem valida e abriu a ação não avisa a si mesmo", async () => {
    const r = await risco("Mesmo");
    await avaliacao(r, "SUBSTANTIAL", "DRAFT", 10);
    const acao = await abrirAcao(owner, r, 20);
    expect(acao.status, JSON.stringify(acao.body)).toBe(201);
    const nova = await avaliacao(r, "TOLERABLE", "DRAFT", 1);
    await request(app).post(`/api/assessments/${nova}/validate`).set(as(owner));
    expect(await avisos(owner.user.id, acao.body.action.id)).toEqual([]);
  });

  it("ação já validada não é avisada", async () => {
    const r = await risco("Encerrada");
    await avaliacao(r, "SUBSTANTIAL", "DRAFT", 10);
    const acao = await abrirAcao(sst, r, 20);
    await prisma.action.update({
      where: { id: acao.body.action.id },
      data: { status: "VALIDATED" },
    });
    const nova = await avaliacao(r, "MODERATE", "DRAFT", 1);
    await request(app).post(`/api/assessments/${nova}/validate`).set(as(owner));
    expect(await avisos(sst.user.id, acao.body.action.id)).toEqual([]);
  });
});

describe("a tela [B3-2-A]", () => {
  it("a mesma regra do servidor: a mais recente, validada ou não, sem a substituída", () => {
    const t = (min: number) => new Date(Date.UTC(2026, 9, 27, 12, min)).toISOString();
    expect(nivelParaPrazo([])).toBeNull();
    expect(
      nivelParaPrazo([
        { status: "VALIDATED", resultingLevel: "MODERATE", assessedAt: t(0) },
        { status: "DRAFT", resultingLevel: "SUBSTANTIAL", assessedAt: t(5) },
      ]),
    ).toEqual({ nivel: "SUBSTANTIAL", validada: false });
    expect(
      nivelParaPrazo([
        { status: "DRAFT", resultingLevel: "SUBSTANTIAL", assessedAt: t(5) },
        { status: "VALIDATED", resultingLevel: "MODERATE", assessedAt: t(0) },
      ]),
      "a ordem da lista não decide",
    ).toEqual({ nivel: "SUBSTANTIAL", validada: false });
    expect(
      nivelParaPrazo([
        { status: "VALIDATED", resultingLevel: "MODERATE", assessedAt: t(0) },
        { status: "SUPERSEDED", resultingLevel: "INTOLERABLE", assessedAt: t(9) },
      ]),
    ).toEqual({ nivel: "MODERATE", validada: true });
    expect(
      nivelParaPrazo([{ status: "SUPERSEDED", resultingLevel: "INTOLERABLE", assessedAt: t(9) }]),
    ).toBeNull();
  });

  it("o formulário lê as avaliações e diz de onde vem o nível", () => {
    const p = plano(fonte("pages", "ControlActionPanel.tsx"));
    expect(p, "o stripper não comeu o código").toContain("export function ControlActionPanel");
    expect(p).toContain("setAvaliado(nivelParaPrazo(av.assessments));");
    expect(p).toContain("atual = nivelParaPrazo((await fetchAssessments(riskId)).assessments);");
    expect(p).toContain('avaliado?.validada ? "" : ", aguardando validação"');
    expect(p).not.toContain("Sem risco avaliado");
    expect(p).not.toContain("riskLevel: string | null;");
    const hazard = plano(fonte("pages", "HazardFormPage.tsx"));
    expect(hazard).not.toContain("riskLevel={level}");
  });
});
