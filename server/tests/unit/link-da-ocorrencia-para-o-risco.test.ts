import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * O link da ocorrência para o risco parece link. [B4-D]
 *
 * "Risco: … abrir no inventário, com o histórico" lia-se como uma frase: a
 * base tira cor e sublinhado de todo link, e este não tinha estilo próprio.
 * Na sessão, o link foi achado por acaso.
 */
const PAGINAS = join(__dirname, "..", "..", "..", "client", "src", "pages");
const tela = readFileSync(join(PAGINAS, "OccurrenceDetailPage.tsx"), "utf8")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\s+/g, " ");
const estilo = readFileSync(join(PAGINAS, "occurrence-detail.css"), "utf8").replace(/\s+/g, " ");

describe("o link para o risco [B4-D]", () => {
  it("fica na própria linha, com classe própria e texto que diz aonde leva", () => {
    expect(tela).toContain(
      '<p className="occ-risco"> <Link className="occ-risco-link" to={`/inventario?risco=${row.risk.id}`}> Ver o risco no inventário, com o histórico </Link> </p>',
    );
    expect(tela).not.toContain("abrir no inventário, com o histórico");
  });

  it("a classe dá cor e sublinhado de link", () => {
    const regra = estilo.slice(estilo.indexOf(".occ-risco-link {"), estilo.indexOf("}", estilo.indexOf(".occ-risco-link {")));
    expect(regra).toContain("color: var(--primary);");
    expect(regra).toContain("text-decoration: underline;");
  });
});
