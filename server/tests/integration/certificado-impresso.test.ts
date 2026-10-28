import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * O certificado impresso é uma folha só, branca.
 *
 * Impresso no celular, saía com uma segunda página em branco. Conferido em
 * PDF A4 (Chrome, nas larguras de computador e de celular): uma página, mas
 * com o fundo da aplicação em volta da folha quando o navegador imprime as
 * cores de fundo. [B2-3-C]
 */
const CSS = readFileSync(
  join(__dirname, "..", "..", "..", "client", "src", "pages", "certificado.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, " ");

const impressao = (() => {
  const i = CSS.indexOf("@media print");
  let nivel = 0;
  for (let j = CSS.indexOf("{", i); j < CSS.length; j++) {
    if (CSS[j] === "{") nivel++;
    if (CSS[j] === "}") nivel--;
    if (nivel === 0) return CSS.slice(i, j + 1).replace(/\s+/g, " ");
  }
  return "";
})();

describe("a impressão do certificado [B2-3-C]", () => {
  it("o fundo da página é branco, não o da aplicação", () => {
    expect(impressao).toMatch(/html, body, #root \{ background: #fff !important; \}/);
  });

  it("o resto da tela sai do fluxo, e a altura mínima da aplicação não empurra uma segunda página", () => {
    expect(impressao).toMatch(/\.sidebar,[^{]*\.app-topbar[^{]*\{ display: none !important; \}/);
    expect(impressao).toMatch(/\.app-shell, \.app-main, \.app-content \{[^}]*min-height: 0 !important;[^}]*height: auto !important;/);
  });

  it("a folha é A4 e não se parte", () => {
    expect(impressao).toMatch(/@page \{ size: A4;/);
    expect(impressao).toMatch(/\.cert-sheet \{[^}]*break-inside: avoid;/);
  });
});
