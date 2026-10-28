import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * O perigo grande atravessa a página em vez de deixar outra em branco.
 *
 * Com o item inteiro e sem quebra, o perigo que não cabia numa página ia
 * todo para a seguinte: a primeira página saía só com o cabeçalho do
 * documento, e o título do perigo ficava longe da tabela. Conferido em PDF
 * A4 (Chrome): de 16 para 14 páginas, a primeira já com o primeiro perigo,
 * o cabeçalho da tabela repetido e a declaração depois do último item.
 * [B3-2-C]
 */
const css = readFileSync(join(__dirname, "..", "..", "..", "client", "src", "pages", "document-view.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\s+/g, " ");
const impressao = css.slice(css.indexOf("@media print"));

describe("a paginação do documento do PGR [B3-2-C]", () => {
  it("o perigo pode atravessar a página", () => {
    expect(impressao).toContain(".doc-item { break-inside: auto; }");
    expect(impressao).not.toMatch(/\.doc-item, \.doc-signature \{ break-inside: avoid; \}/);
  });

  it("o título e os dados do perigo ficam juntos e presos ao começo da tabela", () => {
    expect(impressao).toContain(".doc-item > h3, .doc-item > .doc-facts { break-inside: avoid; break-after: avoid; }");
  });

  it("a linha do risco se parte entre medidas, nunca no meio de uma, e o cabeçalho se repete", () => {
    expect(impressao).toContain(".doc-table tr { break-inside: auto; }");
    expect(impressao).toContain(".doc-table li { break-inside: avoid; }");
    expect(impressao).toContain(".doc-table thead { display: table-header-group; }");
  });

  it("a declaração de assinatura continua inteira", () => {
    expect(impressao).toContain(".doc-signature { break-inside: avoid; }");
  });
});
