import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/app";

/**
 * Os critérios do GRO são conteúdo do inventário, não um terceiro documento.
 *
 * Decisão B3-4-J: Documentos do PGR deixa de dizer "o MTE lista três" e o
 * Painel deixa de cobrar o terceiro documento — a norma pede dois (1.5.7.1)
 * e trata os critérios como conteúdo do inventário (1.5.7.3.2 "f"). Os
 * documentos de critérios já emitidos continuam abrindo (o caso está em
 * `pgr-documento-abre.test.ts`). [B3-4-J]
 *
 * Usa o seed principal (`admin` / `admin123`, Organização Demo): o inventário
 * dela é pequeno e o retrato sai rápido.
 */
const EST_ID = "00000000-0000-4000-8000-000000000010";
const CLIENTE = join(__dirname, "..", "..", "..", "client", "src");

let app: Express;
let admin: string;
const as = () => ({ Authorization: `Bearer ${admin}` });

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
  const res = await request(app).post("/api/auth").send({ login: "admin", password: "admin123" });
  expect(res.status).toBe(200);
  admin = res.body.token as string;
});

describe("dois documentos obrigatórios [B3-4-J]", () => {
  it("a lista de documentos pede o inventário e o plano de ação", async () => {
    const res = await request(app).get("/api/pgr-documents").set(as());
    expect(res.status).toBe(200);
    expect(res.body.required_types).toEqual(["INVENTORY", "ACTION_PLAN"]);
  });

  it("emitir os critérios à parte é recusado, e a resposta diz onde eles estão", async () => {
    const res = await request(app)
      .post("/api/pgr-documents")
      .set(as())
      .send({ type: "CRITERIA", responsible_name: "Eng. Responsável Demo" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CRITERIA_IN_INVENTORY");
    expect(res.body.message).toContain("inventário");
  });

  it("o Painel cobra dois documentos, sem os critérios, e cita o 1.5.7.1", async () => {
    const res = await request(app).get("/api/fiscalizacao").set(as());
    expect(res.status).toBe(200);
    const docs = (res.body.checks as Array<{
      id: string;
      requirement: string;
      items: { label: string }[];
    }>).find((c) => c.id === "documentos")!;
    expect(docs.items.map((i) => i.label)).toEqual(["Inventário de riscos", "Plano de ação"]);
    expect(docs.requirement).toContain("1.5.7.1");
    expect(docs.requirement).not.toContain("1.5.7.2");
  });
});

describe("os critérios vão dentro do inventário [B3-4-J]", () => {
  it("o inventário vivo traz as metodologias", async () => {
    const res = await request(app).get("/api/inventory").set(as());
    expect(res.status).toBe(200);
    const criterios = res.body.inventory.criteria;
    expect(criterios, "o inventário não trazia os critérios").toBeTruthy();
    expect(criterios.methodologies.length).toBeGreaterThanOrEqual(1);
    expect(criterios.methodologies[0].version.matrix).toBeTruthy();
  });

  it("o inventário emitido congela os critérios junto", async () => {
    const res = await request(app)
      .post("/api/pgr-documents")
      .set(as())
      .send({
        type: "INVENTORY",
        establishment_id: EST_ID,
        responsible_name: "Eng. Responsável Demo",
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(201);
    const criterios = res.body.document.content.criteria;
    expect(criterios.methodologies.length).toBeGreaterThanOrEqual(1);
  });
});

describe("as telas [B3-4-J]", () => {
  it("Documentos do PGR fala em dois documentos e cita a norma", () => {
    const p = plano(fonte("pages", "DocumentsPage.tsx"));
    expect(p, "o stripper não comeu o código").toContain("export function DocumentsPage");
    expect(p).not.toContain("O MTE lista três");
    expect(p).not.toContain("Os três documentos exigidos");
    expect(p).toContain("A NR-1 pede no mínimo dois (1.5.7.1)");
    expect(p).not.toContain("Object.keys(PGR_TYPE_LABEL)");
    expect(p.match(/\["INVENTORY", "ACTION_PLAN"\]/g)?.length).toBe(2);
  });

  it("o inventário emitido mostra os critérios; o documento antigo de critérios abre e explica", () => {
    const p = plano(fonte("pages", "DocumentViewPage.tsx"));
    expect(p).toContain(
      '{doc.type === "INVENTORY" && (doc.content as InventoryContent).criteria && (',
    );
    expect(p).toContain("<h2>Critérios de avaliação e de tomada de decisão</h2>");
    expect(p).toContain("<Criteria content={(doc.content as InventoryContent).criteria!} />");
    expect(p).toContain("Emitido como documento à parte.");
    expect(p).toContain("<Criteria content={doc.content as CriteriaContent} />");
  });
});
