import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O texto oficial atual da NR-1 vai até o 1.5.6.2 na seção 1.5.6: o portal
 * não cita "1.5.6.3" em tela, cartão ou comentário. [C4-10]
 */
function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" ? [] : arquivos(p);
    return /\.(ts|tsx|css)$/.test(n) ? [p] : [];
  });
}

describe("sem citação do 1.5.6.3 [C4-10]", () => {
  it("nenhum arquivo do cliente ou do servidor cita 1.5.6.3", () => {
    const raiz = join(__dirname, "..", "..", "..");
    const citam = [...arquivos(join(raiz, "client", "src")), ...arquivos(join(raiz, "server", "src"))].filter((f) =>
      readFileSync(f, "utf8").includes("1.5.6.3"),
    );
    expect(citam).toEqual([]);
  });
});
