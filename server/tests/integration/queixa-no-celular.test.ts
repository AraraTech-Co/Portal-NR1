import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { BODY_PART_MAX } from "../../src/constants";
import { ONDE_INCOMODA_MAX } from "../../../client/src/lib/labels";

/**
 * A queixa ergonômica cabe no celular.
 *
 * O texto de "Onde incomoda" virava etiqueta de uma linha só no cartão, e o
 * campo aceitava uma frase inteira: no tamanho do iPhone, o cartão passava
 * da borda. Agora o lugar do corpo é texto, as etiquetas quebram linha, e o
 * campo pede poucas palavras — na tela e no servidor. [B3-3-D]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
const CLIENTE = join(__dirname, "..", "..", "..", "client", "src");

function semComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const fonte = (...c: string[]) =>
  semComentarios(readFileSync(join(CLIENTE, ...c), "utf8"));
const plano = (t: string) => t.replace(/\s+/g, " ");

let app: Express;
let colaborador: { token: string; user: { id: string } };
const criadas: string[] = [];

const registrar = (body: Record<string, unknown>) =>
  request(app)
    .post("/api/queixas-ergonomicas")
    .set({ Authorization: `Bearer ${colaborador.token}` })
    .send(body);

beforeAll(async () => {
  app = createApp();
  const res = await request(app)
    .post("/api/auth")
    .send({ login: "teste.colaborador", password: SENHA });
  expect(res.status).toBe(200);
  colaborador = res.body;
});

afterAll(async () => {
  /* Pelo sufixo também: uma recusa que falhe grava sem passar por `criadas`. */
  await prisma.ergonomicComplaint.deleteMany({
    where: { OR: [{ id: { in: criadas } }, { description: { contains: SUFIXO } }] },
  });
});

describe("o servidor pede poucas palavras em \"Onde incomoda\" [B3-3-D]", () => {
  it("a frase inteira é recusada, dizendo onde ela vai, e nada é gravado", async () => {
    const frase = `Ombro direito quando levanto a caixa da prateleira de cima ${SUFIXO}`;
    expect(frase.length).toBeGreaterThan(BODY_PART_MAX);

    const res = await registrar({ description: `Dói ${SUFIXO}-longa`, body_part: frase });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BODY_PART_TOO_LONG");
    expect(res.body.limit).toBe(BODY_PART_MAX);
    expect(res.body.message).toMatch(/O que incomoda/);

    const nada = await prisma.ergonomicComplaint.findFirst({
      where: { description: `Dói ${SUFIXO}-longa` },
    });
    expect(nada).toBeNull();
  });

  it("um caractere acima do limite já é recusado", async () => {
    const res = await registrar({
      description: `Dói ${SUFIXO}-61`,
      body_part: "x".repeat(BODY_PART_MAX + 1),
    });
    expect(res.status).toBe(400);
  });

  it("no limite exato, passa e fica gravado", async () => {
    const onde = "y".repeat(BODY_PART_MAX);
    const res = await registrar({ description: `Dói ${SUFIXO}-60`, body_part: onde });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    criadas.push(res.body.complaint.id);
    expect(res.body.complaint.bodyPart).toBe(onde);
  });

  it("o espaço em volta não conta, e é tirado", async () => {
    const onde = "z".repeat(BODY_PART_MAX);
    const res = await registrar({ description: `Dói ${SUFIXO}-esp`, body_part: `  ${onde}   ` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    criadas.push(res.body.complaint.id);
    expect(res.body.complaint.bodyPart).toBe(onde);
  });

  it("sem \"Onde incomoda\", continua opcional", async () => {
    const res = await registrar({ description: `Dói ${SUFIXO}-sem` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    criadas.push(res.body.complaint.id);
    expect(res.body.complaint.bodyPart).toBeNull();
  });
});

describe("a tela [B3-3-D]", () => {
  const tela = plano(fonte("pages", "ErgonomicComplaints.tsx"));
  const css = plano(fonte("pages", "ergonomia.css"));

  it("o campo tem o mesmo limite do servidor, e diz o que escrever", () => {
    expect(ONDE_INCOMODA_MAX).toBe(BODY_PART_MAX);
    expect(tela).toContain("maxLength={ONDE_INCOMODA_MAX}");
    expect(tela).not.toContain("maxLength={120}");
    expect(tela).toMatch(/Só o lugar do corpo/);
  });

  it("o lugar do corpo é texto, não etiqueta", () => {
    expect(tela).not.toMatch(/<Chip[^>]*>\s*\{q\.bodyPart\}/);
    expect(tela).toMatch(/<strong>Onde incomoda:<\/strong> \{q\.bodyPart\}/);
  });

  it("as etiquetas de nome, função e unidade quebram linha", () => {
    for (const campo of ["q.user.name", "q.jobRoleName", "q.establishment.name"]) {
      expect(tela, campo).toContain(`<Chip className="chip-quebra">{${campo}}</Chip>`);
    }
    const regra = css.match(/\.chip-quebra \{([^}]*)\}/)?.[1] ?? "";
    expect(regra).toMatch(/white-space: normal/);
    expect(regra).toMatch(/max-width: 100%/);
  });

  it("o cartão pode encolher até a largura da tela", () => {
    const regra = css.match(/\.queixa \{([^}]*)\}/)?.[1] ?? "";
    expect(regra).toMatch(/min-width: 0/);
    expect(tela).toContain('<li key={q.id} className="queixa">');
  });
});
