import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { computeDueAt } from "../../src/helper/business-days";

/**
 * Filtros na lista do comitê e exportação em PDF. [C1-6]
 *
 * Filtro e paginação no servidor, dentro do recorte de acesso. O PDF da
 * lista usa o mesmo filtro e não traz relato nem mensagens; o PDF de uma
 * denúncia traz relato e mensagens sem identificar quem relatou. As duas
 * exportações ficam na trilha.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const EST_ID = "aaaaaaaa-0001-4000-8000-000000000011";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36).toUpperCase();

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let master: { token: string; user: { id: string } };
let rh: { token: string; user: { id: string } };
let colaborador: { token: string; user: { id: string; name: string } };
let outraUnidade: string;
const relatos: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string; name: string } };
}

async function denunciar(opts: {
  unidade?: string;
  category?: string;
  identificada?: boolean;
} = {}) {
  const req = request(app).post("/api/ethics-reports");
  if (opts.identificada) req.set(as(colaborador.token));
  const res = await req.send({
    organization_id: ORG_ID,
    establishment_id: opts.unidade ?? EST_ID,
    category: opts.category ?? "MISCONDUCT",
    description: `Relato ${SUFIXO} para os filtros do comitê, com detalhes suficientes.`,
    is_anonymous: !opts.identificada,
    committee_involved: false,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  relatos.push(res.body.report.id);
  return { id: res.body.report.id as string, protocol: res.body.report.protocol as string };
}

beforeAll(async () => {
  app = createApp();
  master = await entrar("teste.master");
  rh = await entrar("teste.rh");
  colaborador = await entrar("teste.colaborador");
  await prisma.ethicsCommitteeMember.deleteMany({ where: { organizationId: ORG_ID } });
  outraUnidade = (
    await prisma.establishment.create({
      data: { organizationId: ORG_ID, name: `Filial B ${SUFIXO}`, address: "Rua Z, 3" },
    })
  ).id;
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: relatos } } });
  await prisma.auditEvent.deleteMany({
    where: { organizationId: ORG_ID, action: "ethics_report.export_list", actorId: master.user.id },
  });
  await prisma.ethicsReportCited.deleteMany({ where: { reportId: { in: relatos } } });
  await prisma.ethicsReport.deleteMany({ where: { id: { in: relatos } } });
  await prisma.establishment.deleteMany({ where: { id: outraUnidade } });
});

describe("filtros da lista [C1-6]", () => {
  it("unidade: só as dela, e o PDF da lista também", async () => {
    const naB = await denunciar({ unidade: outraUnidade });
    const naCentro = await denunciar();

    const lista = await request(app)
      .get(`/api/ethics-reports?unidade=${outraUnidade}`)
      .set(as(master.token));
    expect(lista.status, JSON.stringify(lista.body)).toBe(200);
    const ids = lista.body.reports.map((r: { id: string }) => r.id);
    expect(ids).toContain(naB.id);
    expect(ids).not.toContain(naCentro.id);
    expect(lista.body.total).toBe(ids.length);

    const pdf = await request(app)
      .get(`/api/ethics-reports/export?unidade=${outraUnidade}`)
      .set(as(master.token));
    expect(pdf.status, JSON.stringify(pdf.body)).toBe(200);
    const protocolos = pdf.body.rows.map((r: { protocol: string }) => r.protocol);
    expect(protocolos).toContain(naB.protocol);
    expect(protocolos).not.toContain(naCentro.protocol);
    // O filtro vai escrito no cabeçalho: a tela recebe o filtro e o nome da unidade.
    expect(pdf.body.filters.establishmentId).toBe(outraUnidade);
    expect(pdf.body.establishment_name).toBe(`Filial B ${SUFIXO}`);
    // Sem relato e sem mensagens.
    const texto = JSON.stringify(pdf.body);
    expect(texto).not.toContain("para os filtros do comitê");
    for (const linha of pdf.body.rows) {
      expect(linha).not.toHaveProperty("description");
      expect(linha).not.toHaveProperty("messages");
    }
  });

  it("status (vários), gravidade, categoria, protocolo e ciência combinam", async () => {
    const alta = await denunciar({ category: "DISCRIMINATION" });
    const normal = await denunciar({ category: "OTHER" });
    await request(app)
      .patch(`/api/ethics-reports/${normal.id}`)
      .set(as(master.token))
      .send({ status: "IN_ANALYSIS" });

    const porGravidade = await request(app)
      .get("/api/ethics-reports?gravidade=HIGH&categoria=DISCRIMINATION&status=RECEIVED,IN_ANALYSIS")
      .set(as(master.token));
    const ids = porGravidade.body.reports.map((r: { id: string }) => r.id);
    expect(ids).toContain(alta.id);
    expect(ids).not.toContain(normal.id);

    const porProtocolo = await request(app)
      .get(`/api/ethics-reports?protocolo=${normal.protocol.toLowerCase()}`)
      .set(as(master.token));
    expect(porProtocolo.body.reports.map((r: { id: string }) => r.id)).toContain(normal.id);

    const emAnalise = await request(app)
      .get("/api/ethics-reports?status=IN_ANALYSIS&ciencia=sem")
      .set(as(master.token));
    const idsAnalise = emAnalise.body.reports.map((r: { id: string }) => r.id);
    expect(idsAnalise).toContain(normal.id);
    expect(idsAnalise).not.toContain(alta.id);
  });

  it("período do recebimento e situação do prazo", async () => {
    const velha = await denunciar();
    const createdAt = new Date("2026-01-15T12:00:00-03:00");
    await prisma.ethicsReport.update({
      where: { id: velha.id },
      data: { createdAt, dueAt: computeDueAt(createdAt, "NORMAL") },
    });
    const noPeriodo = await request(app)
      .get("/api/ethics-reports?de=2026-01-15&ate=2026-01-15&prazo=OVERDUE")
      .set(as(master.token));
    expect(noPeriodo.status, JSON.stringify(noPeriodo.body)).toBe(200);
    const ids = noPeriodo.body.reports.map((r: { id: string }) => r.id);
    expect(ids).toContain(velha.id);
    for (const r of noPeriodo.body.reports) expect(r.deadline_situation).toBe("OVERDUE");

    const foraDoPeriodo = await request(app)
      .get("/api/ethics-reports?de=2026-01-16")
      .set(as(master.token));
    expect(foraDoPeriodo.body.reports.map((r: { id: string }) => r.id)).not.toContain(velha.id);
  });

  it("ordem padrão: atrasadas, depois as que vencem hoje, depois as mais recentes", async () => {
    const lista = await request(app).get("/api/ethics-reports").set(as(master.token));
    const rank = (s: string) => (s === "OVERDUE" ? 0 : s === "DUE_TODAY" ? 1 : 2);
    const situacoes = lista.body.reports.map((r: { deadline_situation: string }) => rank(r.deadline_situation));
    expect([...situacoes].sort((a: number, b: number) => a - b)).toEqual(situacoes);
  });

  it("filtro inválido é recusado com o campo", async () => {
    for (const [q, campo] of [
      ["status=FEITO", "status"],
      ["gravidade=MEDIA", "gravidade"],
      ["de=2026-02-30", "de"],
      ["de=2026-03-01&ate=2026-02-01", "ate"],
      ["prazo=NUNCA", "prazo"],
      ["ciencia=talvez", "ciencia"],
    ]) {
      const res = await request(app).get(`/api/ethics-reports?${q}`).set(as(master.token));
      expect(res.status, q).toBe(400);
      expect(res.body.field, q).toBe(campo);
    }
  });

  it("paginação: 50 por página, com o total", async () => {
    const lista = await request(app).get("/api/ethics-reports").set(as(master.token));
    expect(lista.body.page).toBe(1);
    expect(lista.body.page_size).toBe(50);
    expect(lista.body.reports.length).toBeLessThanOrEqual(50);
    expect(lista.body.total).toBeGreaterThanOrEqual(lista.body.reports.length);
  });
});

describe("recorte de acesso [C1-6] [CB-27]", () => {
  it("citado não vê a denúncia na lista nem no PDF da lista, e não exporta o detalhe", async () => {
    const r = await denunciar({ unidade: outraUnidade });
    await prisma.ethicsReportCited.create({
      data: { reportId: r.id, userId: rh.user.id, markedById: master.user.id },
    });
    const lista = await request(app)
      .get(`/api/ethics-reports?unidade=${outraUnidade}`)
      .set(as(rh.token));
    expect(lista.status).toBe(200);
    expect(lista.body.reports.map((x: { id: string }) => x.id)).not.toContain(r.id);

    const pdf = await request(app)
      .get(`/api/ethics-reports/export?unidade=${outraUnidade}`)
      .set(as(rh.token));
    expect(pdf.status).toBe(200);
    expect(pdf.body.rows.map((x: { protocol: string }) => x.protocol)).not.toContain(r.protocol);

    const um = await request(app).get(`/api/ethics-reports/${r.id}/export`).set(as(rh.token));
    expect(um.status).toBe(404);
  });

  it("quem não é do comitê não exporta", async () => {
    const res = await request(app).get("/api/ethics-reports/export").set(as(colaborador.token));
    expect(res.status).toBe(403);
  });
});

describe("PDF de uma denúncia [C1-6]", () => {
  it("traz relato e mensagens, sem identificar quem relatou nem quem respondeu pelo comitê", async () => {
    const r = await denunciar({ identificada: true });
    await request(app)
      .post(`/api/ethics-reports/${r.id}/messages`)
      .set(as(master.token))
      .send({ body: "Pode contar mais?" });

    const res = await request(app).get(`/api/ethics-reports/${r.id}/export`).set(as(master.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.report.description).toContain(SUFIXO);
    expect(res.body.report.reporter).toBe("Identificada (consultar no portal)");
    expect(res.body.report.messages).toHaveLength(1);
    expect(res.body.report.messages[0].author).toBe("Comitê");

    const texto = JSON.stringify(res.body);
    expect(texto).not.toContain(colaborador.user.id);
    expect(texto).not.toContain(colaborador.user.name);
    expect(texto).not.toContain(master.user.id);
    expect(texto).not.toContain("reporterUserId");
    expect(texto).not.toContain("accessCodeHash");
  });

  it("as duas exportações ficam na trilha", async () => {
    const r = await denunciar();
    await request(app).get(`/api/ethics-reports/${r.id}/export`).set(as(master.token));
    const um = await prisma.auditEvent.findFirst({
      where: { entityId: r.id, action: "ethics_report.export" },
    });
    expect(um?.actorId).toBe(master.user.id);
    expect(um?.context).toMatchObject({ protocol: r.protocol });

    const antes = new Date();
    await request(app)
      .get(`/api/ethics-reports/export?unidade=${outraUnidade}`)
      .set(as(master.token));
    const lista = await prisma.auditEvent.findFirst({
      where: {
        organizationId: ORG_ID,
        action: "ethics_report.export_list",
        actorId: master.user.id,
        createdAt: { gte: antes },
      },
    });
    expect(lista?.context).toMatchObject({ filters: { establishmentId: outraUnidade } });
    expect(typeof (lista?.context as { count?: unknown })?.count).toBe("number");
  });
});
