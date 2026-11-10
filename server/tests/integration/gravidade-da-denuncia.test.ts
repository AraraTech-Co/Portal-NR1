import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Gravidade da denúncia. [C1-1]
 *
 * O servidor a define pela categoria: assédio sexual e discriminação entram
 * como Alta; as outras, como Normal. O comitê pode ajustar, sempre com
 * justificativa, e o ajuste fica à vista no detalhe com autor e data.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const EST_ID = "aaaaaaaa-0001-4000-8000-000000000011";
const SENHA = "teste1234";

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let master: { token: string; user: { id: string; name: string } };
let rh: { token: string; user: { id: string } };
let colaborador: { token: string; user: { id: string } };
const relatos: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string; name: string } };
}

async function denunciar(category: string): Promise<string> {
  const res = await request(app).post("/api/ethics-reports").send({
    organization_id: ORG_ID,
    establishment_id: EST_ID,
    category,
    description: "Relato de teste da gravidade, com mais de vinte caracteres.",
    is_anonymous: true,
    committee_involved: false,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  relatos.push(res.body.report.id);
  return res.body.report.id as string;
}

beforeAll(async () => {
  app = createApp();
  master = await entrar("teste.master");
  rh = await entrar("teste.rh");
  colaborador = await entrar("teste.colaborador");
  await prisma.ethicsCommitteeMember.deleteMany({ where: { organizationId: ORG_ID } });
});

afterAll(async () => {
  await prisma.ethicsReportCited.deleteMany({ where: { reportId: { in: relatos } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: relatos } } });
  await prisma.ethicsReport.deleteMany({ where: { id: { in: relatos } } });
});

describe("gravidade pela categoria [C1-1]", () => {
  it("assédio sexual e discriminação entram como Alta; as outras, como Normal", async () => {
    const esperado: Record<string, string> = {
      HARASSMENT_SEXUAL: "HIGH",
      DISCRIMINATION: "HIGH",
      HARASSMENT_MORAL: "NORMAL",
      MISCONDUCT: "NORMAL",
      FRAUD_OR_MISUSE: "NORMAL",
      DATA_LEAK: "NORMAL",
      SAFETY_RISK: "NORMAL",
      OTHER: "NORMAL",
    };
    for (const [categoria, gravidade] of Object.entries(esperado)) {
      const id = await denunciar(categoria);
      const res = await request(app).get(`/api/ethics-reports/${id}`).set(as(master.token));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.report.severity, categoria).toBe(gravidade);
      expect(res.body.report.severitySource, categoria).toBe("AUTO");
    }
  });

  it("quem relata não escolhe a gravidade", async () => {
    const res = await request(app).post("/api/ethics-reports").send({
      organization_id: ORG_ID,
      establishment_id: EST_ID,
      category: "OTHER",
      description: "Tentando mandar a gravidade junto com o relato de teste.",
      is_anonymous: true,
      committee_involved: false,
      severity: "HIGH",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    relatos.push(res.body.report.id);
    const lido = await prisma.ethicsReport.findUniqueOrThrow({
      where: { id: res.body.report.id },
      select: { severity: true },
    });
    expect(lido.severity).toBe("NORMAL");
  });
});

describe("ajuste do comitê [C1-1]", () => {
  it("sem justificativa é recusado, e nada muda", async () => {
    const id = await denunciar("MISCONDUCT");
    for (const reason of [undefined, "", "   "]) {
      const res = await request(app)
        .post(`/api/ethics-reports/${id}/gravidade`)
        .set(as(master.token))
        .send({ severity: "HIGH", reason });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.field).toBe("reason");
    }
    const lido = await prisma.ethicsReport.findUniqueOrThrow({
      where: { id },
      select: { severity: true, severitySource: true },
    });
    expect(lido).toEqual({ severity: "NORMAL", severitySource: "AUTO" });
    expect(await prisma.ethicsReportSeverityChange.count({ where: { reportId: id } })).toBe(0);
  });

  it("gravidade inválida é recusada", async () => {
    const id = await denunciar("MISCONDUCT");
    const res = await request(app)
      .post(`/api/ethics-reports/${id}/gravidade`)
      .set(as(master.token))
      .send({ severity: "MEDIUM", reason: "Teste" });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe("severity");
  });

  it("com justificativa: muda, aparece no detalhe com autor e data, e a lista marca", async () => {
    const id = await denunciar("MISCONDUCT");
    const res = await request(app)
      .post(`/api/ethics-reports/${id}/gravidade`)
      .set(as(master.token))
      .send({ severity: "HIGH", reason: "  Há relato de ameaça física.  " });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const detalhe = await request(app).get(`/api/ethics-reports/${id}`).set(as(master.token));
    expect(detalhe.body.report.severity).toBe("HIGH");
    expect(detalhe.body.report.severitySource).toBe("COMMITTEE");
    expect(detalhe.body.report.severityChanges).toHaveLength(1);
    const [ajuste] = detalhe.body.report.severityChanges;
    expect(ajuste.fromSeverity).toBe("NORMAL");
    expect(ajuste.toSeverity).toBe("HIGH");
    expect(ajuste.reason).toBe("Há relato de ameaça física.");
    expect(ajuste.by.id).toBe(master.user.id);
    expect(Number.isNaN(Date.parse(ajuste.at))).toBe(false);

    const lista = await request(app).get("/api/ethics-reports").set(as(master.token));
    const linha = lista.body.reports.find((r: { id: string }) => r.id === id);
    expect(linha.severity).toBe("HIGH");
    expect(linha.severitySource).toBe("COMMITTEE");

    const trilha = await prisma.auditEvent.findFirst({
      where: { entityId: id, action: "ethics_report.severity" },
    });
    expect(trilha?.actorId).toBe(master.user.id);
  });

  it("ajustar para a mesma gravidade é recusado", async () => {
    const id = await denunciar("DISCRIMINATION");
    const res = await request(app)
      .post(`/api/ethics-reports/${id}/gravidade`)
      .set(as(master.token))
      .send({ severity: "HIGH", reason: "Já é alta." });
    expect(res.status).toBe(400);
  });

  it("citado não ajusta: 404, como nas outras ações [CB-27]", async () => {
    const id = await denunciar("MISCONDUCT");
    await prisma.ethicsReportCited.create({
      data: { reportId: id, userId: rh.user.id, markedById: master.user.id },
    });
    const res = await request(app)
      .post(`/api/ethics-reports/${id}/gravidade`)
      .set(as(rh.token))
      .send({ severity: "HIGH", reason: "Tentativa de quem é citado." });
    expect(res.status).toBe(404);
    const lido = await prisma.ethicsReport.findUniqueOrThrow({ where: { id }, select: { severity: true } });
    expect(lido.severity).toBe("NORMAL");
  });

  it("quem não é do comitê não ajusta", async () => {
    const id = await denunciar("MISCONDUCT");
    const res = await request(app)
      .post(`/api/ethics-reports/${id}/gravidade`)
      .set(as(colaborador.token))
      .send({ severity: "HIGH", reason: "Sem acesso ao comitê." });
    expect(res.status).toBe(403);
  });
});
