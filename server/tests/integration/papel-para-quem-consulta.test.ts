import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { pdfBase64 } from "../helpers/pdf";

/**
 * Para quem só consulta, o papel anexado diz o que é. [B4-E]
 *
 * Como fiscal, o simulado e a participação mostravam o anexo como um botão
 * com o nome do arquivo, sem o rótulo ("Ata do simulado assinada"); o Painel
 * dizia "1 evidência(s)" sem dizer que havia papel anexado. Na sessão, a ata
 * não foi encontrada pela fiscal, embora estivesse ali.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

type Sessao = { token: string };
let app: Express;
let sst: Sessao;
let fiscal: Sessao;
const participacoes: string[] = [];
const unidade = { id: "", procedimento: "" };

const as = (s: Sessao) => ({ Authorization: `Bearer ${s.token}` });

async function entrar(login: string): Promise<Sessao> {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body;
}

type Item = { label: string; detail: string };
async function cartao(id: string) {
  const res = await request(app).get("/api/fiscalizacao").set(as(fiscal));
  expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
  return (res.body.checks as { id: string; items: Item[] }[]).find((c) => c.id === id)!;
}

async function participacao(assunto: string) {
  const res = await request(app)
    .post("/api/participations")
    .set(as(sst))
    .send({ type: "SAFETY_DIALOGUE", subject: assunto, occurred_at: new Date().toISOString().slice(0, 10) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  participacoes.push(res.body.participation.id);
  return res.body.participation.id as string;
}

beforeAll(async () => {
  app = createApp();
  sst = await entrar("teste.sst");
  fiscal = await entrar("teste.fiscal");
});

afterAll(async () => {
  if (unidade.procedimento) {
    await prisma.evidence.deleteMany({ where: { drill: { procedureId: unidade.procedimento } } });
    await prisma.emergencyDrill.deleteMany({ where: { procedureId: unidade.procedimento } });
    await prisma.auditEvent.deleteMany({ where: { entityId: { in: [unidade.procedimento, unidade.id] } } });
    await prisma.emergencyProcedure.deleteMany({ where: { id: unidade.procedimento } });
  }
  if (unidade.id) await prisma.establishment.deleteMany({ where: { id: unidade.id } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: participacoes } } });
  await prisma.evidence.deleteMany({ where: { participationId: { in: participacoes } } });
  await prisma.participationRecord.deleteMany({ where: { id: { in: participacoes } } });
});

describe("o Painel diz que há papel anexado [B4-E]", () => {
  it("a participação diz 'papel anexado', não 'evidência(s)'", async () => {
    await participacao(`DDS sem papel ${SUFIXO}`);
    const com = await participacao(`DDS com papel ${SUFIXO}`);
    const anexo = await request(app)
      .post(`/api/participations/${com}/evidences`)
      .set(as(sst))
      .send({
        file_name: "lista.pdf",
        mime_type: "application/pdf",
        content_base64: pdfBase64(["Lista de presença assinada"]),
      });
    expect(anexo.status, JSON.stringify(anexo.body)).toBe(201);

    const itens = (await cartao("participacao")).items;
    expect(itens.find((i) => i.label === `DDS com papel ${SUFIXO}`)!.detail).toBe(
      "DDS (Diálogo Diário de Segurança) · 1 papel anexado (lista, foto ou ata)",
    );
    expect(itens.find((i) => i.label === `DDS sem papel ${SUFIXO}`)!.detail).toContain(
      "sem papel anexado",
    );
    for (const i of itens) expect(i.detail).not.toContain("evidência(s)");
  });

  it("o último simulado sem ata diz 'sem ata anexada'; com a ata, 'ata anexada'", async () => {
    const est = await request(app).post("/api/establishments").set(as(sst)).send({ name: `Ata ${SUFIXO}` });
    expect(est.status, JSON.stringify(est.body)).toBe(201);
    unidade.id = est.body.establishment.id;
    const proc = await request(app)
      .post("/api/emergency-procedures")
      .set(as(sst))
      .send({
        establishment_id: unidade.id,
        scenario: `Incêndio ${SUFIXO}`,
        first_aid_means: "Maleta na portaria",
        responsibles: "Brigada do turno",
        evacuation_plan: "Ponto de encontro no pátio",
      });
    expect(proc.status, JSON.stringify(proc.body)).toBe(201);
    unidade.procedimento = proc.body.procedure.id;
    const drill = await request(app)
      .post(`/api/emergency-procedures/${unidade.procedimento}/drills`)
      .set(as(sst))
      .send({ performed_at: new Date().toISOString(), participants: 8 });
    expect(drill.status, JSON.stringify(drill.body)).toBe(201);

    const daUnidade = async () =>
      (await cartao("emergencia")).items.find((i) => i.label === `Ata ${SUFIXO}`)!.detail;
    expect(await daUnidade()).toMatch(/ · sem ata anexada$/);

    const ata = await request(app)
      .post(`/api/emergency-procedures/${unidade.procedimento}/drills/${drill.body.drill.id}/evidences`)
      .set(as(sst))
      .send({ file_name: "ata.pdf", mime_type: "application/pdf", content_base64: pdfBase64(["Ata assinada"]) });
    expect(ata.status, JSON.stringify(ata.body)).toBe(201);
    const depois = await daUnidade();
    expect(depois).toMatch(/ · ata anexada$/);
    expect(depois).not.toContain("sem ata");
  });

  it("a emergência diz se o último simulado tem ata anexada", async () => {
    const itens = (await cartao("emergencia")).items;
    const comSimulado = itens.filter((i) => i.detail.includes("último simulado registrado"));
    expect(comSimulado.length, "a empresa de teste tem simulado").toBeGreaterThan(0);
    for (const i of comSimulado) expect(i.detail).toMatch(/· (sem )?ata anexada$/);
  });
});

describe("o anexo mostra o nome do papel a quem só lê [B4-E]", () => {
  const componente = readFileSync(
    join(__dirname, "..", "..", "..", "client", "src", "components", "AnexarPapel.tsx"),
    "utf8",
  )
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ");

  it("o rótulo vem antes da lista e fora do formulário de envio", () => {
    const titulo = componente.indexOf('<p className="anexos-titulo">{label}</p>');
    const lista = componente.indexOf("{anexos.length > 0 ? (");
    const formulario = componente.indexOf("{canWrite && (");
    expect(titulo, "o rótulo aparece").toBeGreaterThan(0);
    expect(titulo).toBeLessThan(lista);
    expect(titulo).toBeLessThan(formulario);
    expect(componente.split("{label}").length - 1, "o rótulo uma vez só").toBe(1);
  });
});
