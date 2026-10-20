import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Todo fato gravado na trilha tem nome em português.
 *
 * O Histórico é o que se mostra ao auditor, e nele saíam
 * "ACCOUNT_INVITE_LINK_CREATED" e "assessment.validate". A lista de rótulos
 * é escrita à mão; esta conferência existe para ela não ficar para trás
 * quando um fato novo passa a ser gravado. [B2-1-C] [B2-4-E]
 *
 * Limite conhecido: só enxerga texto entre aspas logo depois de `action:`.
 * Pega o literal e o ternário (`action: x ? "a" : "b"`); ação montada em
 * variável passa despercebida.
 */
const RAIZ = join(__dirname, "..", "..", "src");
const MAPA = join(
  __dirname,
  "..",
  "..",
  "..",
  "client",
  "src",
  "api",
  "inspection.ts",
);

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return caminho.endsWith(".ts") ? [caminho] : [];
  });
}

function acoesGravadas(): string[] {
  const achadas = new Set<string>();
  for (const arquivo of arquivos(RAIZ)) {
    const texto = readFileSync(arquivo, "utf8");
    for (const m of texto.matchAll(/action:\s*([^,\n]+)/g)) {
      for (const lit of m[1]!.matchAll(/"([A-Za-z_.]+)"/g)) {
        achadas.add(lit[1]!);
      }
    }
  }
  return [...achadas].sort();
}

function acoesComRotulo(): string[] {
  const texto = readFileSync(MAPA, "utf8");
  const bloco = texto.match(
    /AUDIT_ACTION_LABEL: Record<string, string> = \{(.*?)\n\};/s,
  );
  expect(bloco, "o mapa de rótulos em client/src/api/inspection.ts").toBeTruthy();
  const chaves = new Set<string>();
  for (const m of bloco![1]!.matchAll(/^\s*"?([A-Za-z_.]+)"?:/gm)) {
    chaves.add(m[1]!);
  }
  return [...chaves].sort();
}

describe("rótulo para todo fato da trilha [B2-1-C]", () => {
  it("a varredura enxerga o que o servidor grava", () => {
    /*
      Sem isto, uma expressão que não casasse mais nada faria a conferência
      seguinte passar sempre.
    */
    const gravadas = acoesGravadas();
    expect(gravadas.length).toBeGreaterThan(30);
    expect(gravadas).toContain("pgr_document.issue");
    expect(gravadas).toContain("service_order.issue");
    // Escrita como ternário: era o ponto cego da varredura anterior.
    expect(gravadas).toContain("fiscal.access_ended");
  });

  it("a lista de rótulos é lida de verdade", () => {
    const comRotulo = acoesComRotulo();
    expect(comRotulo.length).toBeGreaterThan(30);
    expect(comRotulo).toContain("consulta.view");
  });

  it("nenhum fato gravado fica sem nome em português", () => {
    const comRotulo = new Set(acoesComRotulo());
    const semRotulo = acoesGravadas().filter((a) => !comRotulo.has(a));
    expect(semRotulo, `sem rótulo: ${semRotulo.join(", ")}`).toEqual([]);
  });
});
