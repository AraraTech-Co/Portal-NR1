import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O cartaz do aviso: tamanho de cartaz só no impresso, e a margem da lista
 * acompanhando a fonte, para o "10." não sair cortado. [C4-5]
 */
const css = readFileSync(join(__dirname, "..", "..", "..", "client", "src", "pages", "cartaz.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** O CSS fora dos blocos @media print. */
function foraDoImpresso(texto: string): string {
  let out = "";
  let i = 0;
  while (i < texto.length) {
    const inicio = texto.indexOf("@media print", i);
    if (inicio < 0) {
      out += texto.slice(i);
      break;
    }
    out += texto.slice(i, inicio);
    let nivel = 0;
    let j = texto.indexOf("{", inicio);
    for (; j < texto.length; j++) {
      if (texto[j] === "{") nivel++;
      else if (texto[j] === "}" && --nivel === 0) break;
    }
    i = j + 1;
  }
  return out;
}

describe("cartaz do aviso [C4-5]", () => {
  it("a lista do cartaz tem margem em em, não em rem", () => {
    expect(css).toMatch(/\.cartaz-body \.markdown-body ol,\s*\.cartaz-body \.markdown-body ul \{\s*padding-left: 2\.2em;/);
  });

  it("na tela, nenhum tamanho de cartaz: o grande fica só no impresso", () => {
    const tela = foraDoImpresso(css);
    expect(tela).not.toMatch(/font-size:\s*(clamp|[0-9.]+pt)/);
    expect(tela).not.toMatch(/\.cartaz-body \{[^}]*font-size/);
    expect(css).toMatch(/@media print \{[\s\S]*\.cartaz-title \{\s*font-size: 40pt;/);
    expect(css).toMatch(/@media print \{[\s\S]*\.cartaz-body \{\s*font-size: 16pt;/);
  });
});
