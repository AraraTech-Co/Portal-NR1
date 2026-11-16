import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { avisoDasLinhasDeFora } from "../../../client/src/lib/linhas-de-fora";

const semComentarios = (codigo: string) =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const ler = (arquivo: string) =>
  semComentarios(readFileSync(join(__dirname, "../../../client/src/pages", arquivo), "utf8"));

describe("o aviso das linhas de fora concorda com a quantidade [C6-9]", () => {
  it("uma linha, na prévia e no resultado", () => {
    expect(avisoDasLinhasDeFora(1, false)).toEqual({
      titulo: "1 linha da planilha fica de fora",
      resto: "e não será cadastrada. Está na tabela abaixo como Erro, com o motivo.",
    });
    expect(avisoDasLinhasDeFora(1, true).resto).toBe(
      "e não foi cadastrada. Está na tabela abaixo como Erro, com o motivo.",
    );
  });

  it("duas linhas, na prévia e no resultado", () => {
    expect(avisoDasLinhasDeFora(2, false)).toEqual({
      titulo: "2 linhas da planilha ficam de fora",
      resto: "e não serão cadastradas. Estão na tabela abaixo como Erro, com o motivo.",
    });
    expect(avisoDasLinhasDeFora(2, true).resto).toBe(
      "e não foram cadastradas. Estão na tabela abaixo como Erro, com o motivo.",
    );
  });

  it("a tela usa o aviso, com o resultado decidindo o tempo do verbo", () => {
    const tela = ler("ImportPeople.tsx");
    expect(tela).toMatch(/avisoDasLinhasDeFora\(recusadas\.length, Boolean\(relatorio\)\)\.titulo/);
    expect(tela).toMatch(/avisoDasLinhasDeFora\(recusadas\.length, Boolean\(relatorio\)\)\.resto/);
    expect(tela).not.toMatch(/serão cadastradas/);
  });
});

describe("o histórico da ficha em português e dentro da coluna [C6-10]", () => {
  it("a alteração dos dados da folha tem rótulo", () => {
    expect(ler("EmployeeFilePage.tsx")).toMatch(
      /"employee_payroll_data\.update": "Dados da folha da ficha alterados",/,
    );
  });

  it("o texto do meio quebra dentro da coluna", () => {
    const css = ler("people.css");
    expect(css).toMatch(
      /\.people-history li > span:nth-child\(2\) \{\s*min-width: 0;\s*overflow-wrap: anywhere;\s*\}/,
    );
  });
});
