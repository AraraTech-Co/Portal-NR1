import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** O bloco "Cargos sem função" na tela da prévia (Correção 6, C6-2), lido sem os comentários. */
const semComentarios = (codigo: string) =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const tela = semComentarios(
  readFileSync(join(__dirname, "../../../client/src/pages/ImportPeople.tsx"), "utf8"),
);

describe("o bloco de cargos sem função na prévia", () => {
  it("a conferência guarda os cargos, e o bloco aparece na prévia, acima da tabela de pessoas", () => {
    expect(tela).toMatch(/setCargosSemFuncao\(lido\.cargosSemFuncao\);/);
    const bloco = tela.indexOf("{previa && cargosSemFuncao.length > 0 && (");
    const tabelaDePessoas = tela.indexOf("{linhasDaTabela.map(");
    expect(bloco).toBeGreaterThan(-1);
    expect(tabelaDePessoas === -1 || bloco < tabelaDePessoas).toBe(true);
    expect(tela).toMatch(/Cargos sem função nesta planilha: \{cargosSemFuncao\.length\}/);
  });

  it("quem não é Master nem Dono vê o aviso de quem cria", () => {
    expect(tela).toMatch(/const criaFuncoes = editaOperacao && editaConta;/);
    expect(tela).toMatch(/\{!criaFuncoes && \(/);
    expect(tela).toMatch(/Quem cuida da Operação \(Master ou Dono\) cria estas funções\./);
  });

  it("os dois acessos são lidos sempre, sem pular hook", () => {
    expect(tela).not.toMatch(/useModuleAccess\([^)]*\)\.canWrite && useModuleAccess/);
  });

  it("CBO diferente entre as linhas avisa", () => {
    expect(tela).toMatch(/c\.cbo2002\.length > 1 && \(/);
    expect(tela).toMatch(/CBO diferente entre as linhas: confira/);
  });
});
