import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Convocações cabe no celular, e o link da tabela parece link.
 *
 * No celular, as três colunas que ficam somavam 344 px de conteúdo mínimo
 * num quadro de 341: a tabela passava 2 px da tela. E "Abrir o treinamento",
 * como os outros links de tabela, tinha a cara do texto em volta. [S7-G]
 * [B2-1-G]
 */
const css = (...c: string[]) =>
  readFileSync(join(__dirname, "..", "..", "..", "client", "src", ...c), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ");

describe("Convocações no celular", () => {
  it("em tela estreita, as células da tabela têm menos recuo", () => {
    const c = css("pages", "summons.css");
    const celular = c.slice(c.indexOf("@media (max-width: 640px)"));
    expect(celular).toContain(".summons-table .summons-col-extra { display: none; }");
    expect(celular).toContain(".summons-table th, .summons-table td { padding-left: 0.5rem; padding-right: 0.5rem; }");
  });
});

describe("o link da tabela parece link", () => {
  it("cor e sublinhado, menos nos desenhados como botão", () => {
    const c = css("components", "data-table.css");
    expect(c).toMatch(
      /\.data-table td a:not\(\.btn\):not\(\[class\*="-btn"\]\) \{ color: var\(--primary\); text-decoration: underline;/,
    );
  });
});
