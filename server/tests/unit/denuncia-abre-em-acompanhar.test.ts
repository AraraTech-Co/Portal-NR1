import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Quem chega pelo aviso de encerramento cai em "Acompanhar"; pelo menu,
 * continua em "Nova denúncia". [C4-6]
 */
const tela = readFileSync(
  join(__dirname, "..", "..", "..", "client", "src", "pages", "EthicsReportPage.tsx"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("a denúncia abre em Acompanhar pelo aviso [C4-6]", () => {
  it("o modo inicial é 'track' quando o endereço traz ?acompanhar, e 'new' sem ele", () => {
    const linhas = tela.split("\n").filter((l) => l.includes("useState<Mode>("));
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain('semEmpresa || searchParams.has("acompanhar") ? "track" : "new"');
  });
});
