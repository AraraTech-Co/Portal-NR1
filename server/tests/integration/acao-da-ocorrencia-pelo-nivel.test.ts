import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * A ação aberta pela ocorrência segue o prazo pelo nível do risco. [CB-72]
 *
 * Pelo Inventário, o nível do risco sugere prioridade e prazo, e o prazo do
 * nível é limite: passar dele pede o motivo (decisões S2-M e B3-2-A). Pela
 * ocorrência, a tela não mostrava o nível nem o limite, o servidor não
 * conferia o prazo e a prioridade saía sempre Alta — lida, na sessão, como o
 * nível do risco. Agora os dois caminhos seguem a mesma regra.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG = "aaaaaaaa-0001-4000-8000-000000000001";
const ACT_ID = "aaaaaaaa-0001-4000-8000-000000000014";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const emDias = (dias: number) =>
  new Date(Date.now() - 3 * 3_600_000 + dias * 86_400_000).toISOString().slice(0, 10);

let app: Express;
let sst: { token: string; user: { id: string } };
let supervisor: { token: string; user: { id: string } };
let perigo = "";
let ocorrenciaComRisco = "";
let ocorrenciaSemRisco = "";

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

async function ocorrencia(riskId?: string) {
  const res = await request(app)
    .post("/api/occurrences")
    .set(as(sst.token))
    .send({
      type: "DANGEROUS_EVENT",
      description: `Quase-acidente ${SUFIXO}`,
      occurred_at: "2026-10-22T13:00:00.000Z",
      ...(riskId ? { risk_id: riskId } : {}),
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.occurrence.id as string;
}

const acao = (extra: Record<string, unknown>) => ({
  title: `Proteção ${SUFIXO}`,
  assignee_id: supervisor.user.id,
  effectiveness_criteria: "Zero projeções em 60 dias",
  ...extra,
});

beforeAll(async () => {
  app = createApp();
  sst = await entrar("teste.sst");
  supervisor = await entrar("teste.supervisor");

  /* Risco com avaliação Substancial ainda à espera de validação. */
  const h = await prisma.hazard.create({
    data: {
      organizationId: ORG,
      activityId: ACT_ID,
      description: `Perigo da ocorrência ${SUFIXO}`,
      category: "ACCIDENT",
      status: "IDENTIFIED",
      origin: "ROUTINE_REVIEW",
      createdById: sst.user.id,
    },
  });
  perigo = h.id;
  const risco = await prisma.risk.create({
    data: { organizationId: ORG, hazardId: h.id, description: `Risco da ocorrência ${SUFIXO}` },
  });
  const versao = await prisma.riskMethodologyVersion.findFirstOrThrow({
    where: { methodology: { organizationId: null, isDefault: true } },
    orderBy: { version: "desc" },
    select: { id: true },
  });
  await prisma.riskAssessment.create({
    data: {
      organizationId: ORG,
      riskId: risco.id,
      methodologyVersionId: versao.id,
      severity: 4,
      probability: 3,
      resultingLevel: "SUBSTANTIAL",
      status: "DRAFT",
      assessorId: sst.user.id,
    },
  });
  ocorrenciaComRisco = await ocorrencia(risco.id);
  ocorrenciaSemRisco = await ocorrencia();
});

afterAll(async () => {
  const acoes = await prisma.action.findMany({
    where: { occurrenceId: { in: [ocorrenciaComRisco, ocorrenciaSemRisco] } },
    select: { id: true },
  });
  const ids = acoes.map((a) => a.id);
  await prisma.auditEvent.deleteMany({
    where: { entityId: { in: [...ids, ocorrenciaComRisco, ocorrenciaSemRisco] } },
  });
  await prisma.notification.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.action.deleteMany({ where: { id: { in: ids } } });
  await prisma.occurrence.deleteMany({
    where: { id: { in: [ocorrenciaComRisco, ocorrenciaSemRisco] } },
  });
  await prisma.riskAssessment.deleteMany({ where: { risk: { hazardId: perigo } } });
  await prisma.risk.deleteMany({ where: { hazardId: perigo } });
  await prisma.hazard.deleteMany({ where: { id: perigo } });
});

describe("a ação pela ocorrência segue o nível do risco [CB-72]", () => {
  const rota = () => `/api/occurrences/${ocorrenciaComRisco}/actions`;

  it("Substancial, mesmo aguardando validação, limita a 30 dias e pede o motivo para passar", async () => {
    const res = await request(app).post(rota()).set(as(sst.token)).send(acao({ due_date: emDias(45) }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("DEADLINE_NEEDS_JUSTIFICATION");
    expect(res.body.limit_days).toBe(30);
    expect(res.body.message).toContain("Substancial, aguardando validação,");
  });

  it("com o motivo, a ação abre e guarda o motivo e o nível da abertura", async () => {
    const res = await request(app)
      .post(rota())
      .set(as(sst.token))
      .send(acao({ due_date: emDias(45), deadline_justification: "Depende da parada de janeiro" }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const gravada = await prisma.action.findUniqueOrThrow({ where: { id: res.body.action.id } });
    expect(gravada.deadlineJustification).toBe("Depende da parada de janeiro");
    expect(gravada.riskLevelAtOpening).toBe("SUBSTANTIAL");
  });

  it("dentro do limite não pede motivo, e o motivo mandado à toa não é guardado", async () => {
    const res = await request(app)
      .post(rota())
      .set(as(sst.token))
      .send(acao({ due_date: emDias(20), deadline_justification: "à toa" }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const gravada = await prisma.action.findUniqueOrThrow({ where: { id: res.body.action.id } });
    expect(gravada.deadlineJustification).toBeNull();
  });

  it("sem prioridade escolhida, vale a do nível (Substancial → Alta); escolhida, vale a escolha", async () => {
    const sem = await request(app).post(rota()).set(as(sst.token)).send(acao({ due_date: emDias(10) }));
    expect(sem.status).toBe(201);
    expect(sem.body.action.priority).toBe("HIGH");
    const escolhida = await request(app)
      .post(rota())
      .set(as(sst.token))
      .send(acao({ due_date: emDias(10), priority: "CRITICAL" }));
    expect(escolhida.body.action.priority).toBe("CRITICAL");
  });

  it("data que já passou é recusada", async () => {
    const res = await request(app).post(rota()).set(as(sst.token)).send(acao({ due_date: emDias(-1) }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("DEADLINE_IN_THE_PAST");
  });

  it("ocorrência sem risco: prazo livre, prioridade Média quando não escolhida", async () => {
    const res = await request(app)
      .post(`/api/occurrences/${ocorrenciaSemRisco}/actions`)
      .set(as(sst.token))
      .send(acao({ due_date: emDias(200) }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.action.priority).toBe("MEDIUM");
    expect(res.body.action.riskLevelAtOpening).toBeNull();
  });
});

describe("a tela da ocorrência mostra o nível e o limite [CB-72]", () => {
  const tela = readFileSync(
    join(__dirname, "..", "..", "..", "client", "src", "pages", "OccurrenceDetailPage.tsx"),
    "utf8",
  )
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ");

  it("envia a prioridade escolhida e o motivo só quando passa do limite", () => {
    expect(tela).not.toContain('priority: "HIGH"');
    expect(tela).toContain("priority: prioridade,");
    expect(tela).toContain(
      "deadline_justification: passouDoLimite ? justificativa.trim() : undefined,",
    );
  });

  it("lê o nível da avaliação mais recente do risco e sugere prioridade e prazo", () => {
    expect(tela).toContain("atual = nivelParaPrazo((await fetchAssessments(row.risk.id)).assessments);");
    expect(tela).toContain("setPrioridade(sugestao.prioridade);");
    expect(tela).toContain("setPrazo(atual ? isoInDays(sugestao.dias) : \"\");");
    expect(tela).toContain('avaliado.validada ? "" : ", aguardando validação"');
  });

  it("pede o motivo acima do limite, e não abre sem ele", () => {
    expect(tela).toContain(
      "const limiteDias = avaliado ? sugestaoDoNivel(avaliado.nivel).dias : null;",
    );
    expect(tela).toContain("{passouDoLimite && ( <label className=\"form-field\"> Por que este prazo passa de {limiteDias} dias");
    expect(tela).toContain("(passouDoLimite && !justificativa.trim())");
  });
});
