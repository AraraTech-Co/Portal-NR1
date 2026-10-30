import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitBatchPages } from "../../src/helper/payslip-batch";
import { extractPdfPages, extractPdfText, MAX_BATCH_PAGES } from "../../src/helper/pdf-text";
import { pdfDePaginas, paginaDaFolha } from "../helpers/pdf";

/**
 * A folha do mês num arquivo só: em que páginas está cada pessoa. [B4-F]
 *
 * O arquivo de exemplo é fictício, no mesmo layout do arquivo da loja (IOB
 * Office): nove páginas, uma pessoa em duas folhas, uma matrícula sem
 * cadastro e uma página de outra competência.
 */
const LOTE = readFileSync(
  join(__dirname, "..", "fixtures", "holerites", "lote-mensal-outubro-2026.pdf"),
);

describe("as páginas da folha viram uma parte por pessoa [B4-F]", () => {
  it("o arquivo de exemplo dá oito partes, e José leva as páginas 3 e 4", async () => {
    const paginas = await extractPdfPages(LOTE, MAX_BATCH_PAGES + 1);
    expect(paginas).toHaveLength(9);
    const partes = splitBatchPages(paginas!);
    expect(
      partes.map((p) => [p.registration, p.pages]),
    ).toEqual([
      ["000010", [1]],
      ["000019", [2]],
      ["000020", [3, 4]],
      ["000021", [5]],
      ["000022", [6]],
      ["000099", [7]],
      ["000025", [8]],
      ["000018", [9]],
    ]);
    expect(partes.every((p) => p.problem === null)).toBe(true);
    /* O texto da parte é o das páginas dela, e só delas. */
    const jose = partes[2]!;
    expect(jose.name).toBe("JOSE ANTUNES");
    expect(jose.text).toContain("INSALUBRIDADE");
    expect(jose.text).not.toContain("MARCOS");
  });

  it("matrícula com e sem zero à esquerda em páginas seguidas é a mesma pessoa", () => {
    const partes = splitBatchPages([
      paginaDaFolha("000010", "MARCOS OLIVEIRA", "OUTUBRO/2026").join(" "),
      paginaDaFolha("10", "MARCOS OLIVEIRA", "OUTUBRO/2026").join(" "),
    ]);
    expect(partes).toHaveLength(1);
    expect(partes[0]!.pages).toEqual([1, 2]);
  });

  it("página sem funcionário fica sozinha e não se junta a ninguém", () => {
    const partes = splitBatchPages([
      paginaDaFolha("000010", "MARCOS OLIVEIRA", "OUTUBRO/2026").join(" "),
      "RESUMO GERAL DA FOLHA  TOTAL DE FUNCIONARIOS 2  OUTUBRO/2026",
      paginaDaFolha("000010", "MARCOS OLIVEIRA", "OUTUBRO/2026").join(" "),
    ]);
    expect(partes.map((p) => p.problem)).toEqual(["REPETIDA", "SEM_FUNCIONARIO", "REPETIDA"]);
  });

  it("a mesma matrícula em dois trechos separados: nenhum dos dois sai", () => {
    const partes = splitBatchPages([
      paginaDaFolha("000010", "MARCOS OLIVEIRA", "OUTUBRO/2026").join(" "),
      paginaDaFolha("000019", "CARLOS PEREIRA", "OUTUBRO/2026").join(" "),
      paginaDaFolha("000010", "MARCOS OLIVEIRA", "OUTUBRO/2026").join(" "),
    ]);
    expect(partes.map((p) => [p.registration, p.problem])).toEqual([
      ["000010", "REPETIDA"],
      ["000019", null],
      ["000010", "REPETIDA"],
    ]);
  });

  it("duas pessoas na mesma página: a página fica de fora", () => {
    const partes = splitBatchPages([
      [
        ...paginaDaFolha("000010", "MARCOS OLIVEIRA", "OUTUBRO/2026"),
        ...paginaDaFolha("000019", "CARLOS PEREIRA", "OUTUBRO/2026"),
      ].join(" "),
    ]);
    expect(partes).toHaveLength(1);
    expect(partes[0]!.problem).toBe("VARIAS_PESSOAS");
    expect(partes[0]!.registration).toBeNull();
  });
});

describe("o envio individual continua lendo só as dez primeiras páginas [B4-F]", () => {
  it("a página 11 não entra no texto do individual, e entra no do lote", async () => {
    const paginas = Array.from({ length: 11 }, (_, i) =>
      paginaDaFolha(String(2001 + i), `PESSOA NUMERO ${"ABCDEFGHIJK"[i]}`, "OUTUBRO/2026"),
    );
    const pdf = await pdfDePaginas(paginas);
    const individual = await extractPdfText(pdf);
    expect(individual).toContain("2010 - PESSOA NUMERO J");
    expect(individual).not.toContain("2011 - PESSOA NUMERO K");
    const lote = await extractPdfPages(pdf, MAX_BATCH_PAGES + 1);
    expect(lote).toHaveLength(11);
    expect(lote![10]).toContain("2011 - PESSOA NUMERO K");
  });

  it("arquivo que não é PDF não tem páginas", async () => {
    expect(await extractPdfPages(Buffer.from("não é pdf"), 5)).toBeNull();
    expect(await extractPdfText(Buffer.from("não é pdf"))).toBe("");
  });
});
