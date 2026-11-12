import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** A ação aberta pelo achado do simulado: confirmação destacada, com link. [C4-9] */
const tela = readFileSync(
  join(__dirname, "..", "..", "..", "client", "src", "pages", "EmergenciesPage.tsx"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("confirmação da ação do simulado [C4-9]", () => {
  it("aparece destacada e leva à ação no Plano de ação", () => {
    const i = tela.indexOf("{acaoFeita && (");
    expect(i).toBeGreaterThan(0);
    expect(tela.indexOf("{acaoFeita && (", i + 1)).toBe(-1);
    const bloco = tela.slice(i, tela.indexOf("</p>", i));
    expect(bloco).toContain('className="form-success"');
    expect(bloco).not.toContain('className="muted"');
    expect(bloco).toContain("to={`/acoes?acao=${encodeURIComponent(acaoFeita.id)}`}");
  });
});
