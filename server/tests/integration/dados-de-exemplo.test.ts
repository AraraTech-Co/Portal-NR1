import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { ETHICS_PROTOCOL_PREFIX } from "../../src/constants";

/**
 * Os dados de exemplo descrevem uma fábrica, e a denúncia de exemplo abre.
 *
 * A organização de teste descrevia uma loja (unidade, setor, função,
 * expostos), e a queixa ergonômica trazia exemplo de varejo. A denúncia de
 * exemplo tinha o código gravado em SHA-256, e a consulta compara com
 * bcrypt: ela nunca podia ser acompanhada. [OB-11]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`, rodado depois desta
 * mudança.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const RAIZ = join(__dirname, "..", "..", "..");
const VAREJO = /\bloja\b|\bvendas?\b|vendedor|balc[ãa]o|prateleira|g[ôo]ndola|mercadoria|estoqu|\bPDV\b|\bcaixa\b/i;

function semComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

let app: Express;

beforeAll(() => {
  app = createApp();
});

describe("a denúncia de exemplo pode ser acompanhada [OB-11]", () => {
  it("o protocolo e o código do seed abrem a denúncia pela consulta pública", async () => {
    const res = await request(app)
      .post("/api/ethics-reports/track")
      .send({ protocol: "CX-0001", access_code: "ACESSO-TESTE", organization_id: ORG_ID });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.report.protocol).toBe("CX-0001");
  });

  it("o protocolo segue o formato que o portal gera", () => {
    const seed = readFileSync(join(RAIZ, "scripts", "seed-teste-org.ts"), "utf8");
    const protocolo = seed.match(/protocolo: "([^"]+)"/)?.[1] ?? "";
    expect(protocolo).toMatch(new RegExp(`^${ETHICS_PROTOCOL_PREFIX}-\\d{4}$`));
  });

  it("o código é gravado como a consulta compara, também ao rodar o seed de novo", () => {
    const seed = semComentarios(readFileSync(join(RAIZ, "scripts", "seed-teste-org.ts"), "utf8"));
    expect(seed).not.toMatch(/createHash\(\s*"sha256"/);
    expect(seed).toContain("const codigoDaDenuncia = await bcrypt.hash(DENUNCIA_DE_EXEMPLO.codigo, 10);");
    expect(seed).toMatch(/update: \{ protocol: DENUNCIA_DE_EXEMPLO\.protocolo, accessCodeHash: codigoDaDenuncia \}/);
  });
});

describe("os exemplos são de fábrica, não de loja [OB-11]", () => {
  it("o seed não descreve mais uma loja (fora o papel ADM loja, que é do produto)", () => {
    const seed = semComentarios(readFileSync(join(RAIZ, "scripts", "seed-teste-org.ts"), "utf8"))
      .replace(/teste\.admloja/g, "")
      .replace(/ADM Loja Teste/g, "");
    const achados = seed.split("\n").filter((l) => VAREJO.test(l));
    expect(achados).toEqual([]);
  });

  it("a unidade, o setor, a função e o perigo do seed, gravados no banco", async () => {
    const [unidade, setor, funcao, perigo] = await Promise.all([
      prisma.establishment.findUnique({ where: { id: "aaaaaaaa-0001-4000-8000-000000000011" }, select: { name: true } }),
      prisma.sector.findUnique({ where: { id: "aaaaaaaa-0001-4000-8000-000000000012" }, select: { name: true, environmentDescription: true } }),
      prisma.jobRole.findUnique({ where: { id: "aaaaaaaa-0001-4000-8000-000000000013" }, select: { name: true, description: true } }),
      prisma.hazard.findUnique({ where: { id: "aaaaaaaa-0001-4000-8000-000000000020" }, select: { description: true, exposedGroup: true } }),
    ]);
    expect(unidade?.name).toBe("Fábrica Teste Centro");
    const textos = [unidade?.name, setor?.name, setor?.environmentDescription, funcao?.name, funcao?.description, perigo?.description, perigo?.exposedGroup];
    expect(textos.filter((t) => t && VAREJO.test(t))).toEqual([]);
    expect(funcao?.name).toBe("Operador de máquinas");
  });

  it("a queixa ergonômica dá exemplo de fábrica", () => {
    const tela = readFileSync(join(RAIZ, "client", "src", "pages", "ErgonomicComplaints.tsx"), "utf8");
    const exemplos = [...tela.matchAll(/placeholder="([^"]+)"/g)].map((m) => m[1]);
    expect(exemplos.filter((e) => VAREJO.test(e))).toEqual([]);
    expect(exemplos.some((e) => /torno/.test(e))).toBe(true);
  });
});
