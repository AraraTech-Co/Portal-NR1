import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { linhasDoQueJaExistia } from "../../../client/src/api/copia-entre-filiais";

/** O resumo da cópia diz o que já existia no destino (Correção 6, C6-6). */
const r = (setores: number, funcoes: number, exigencias = 0) => ({
  ja_existia: { setores, funcoes },
  exigencias_acrescentadas: exigencias,
  de_fora: [],
});

describe("linhasDoQueJaExistia", () => {
  it("nada existia: nenhuma linha", () => {
    expect(linhasDoQueJaExistia(r(0, 0))).toEqual([]);
  });

  it("um setor e duas funções, com exigência acrescentada", () => {
    expect(linhasDoQueJaExistia(r(1, 2, 1))).toEqual([
      "Já existia: 3 (1 setor e 2 funções). A cópia liga atividades e riscos ao que já existe, sem trocar nome nem CBO.",
      "Exigências acrescentadas a funções que já existiam: 1.",
    ]);
  });

  it("só uma função, no singular", () => {
    expect(linhasDoQueJaExistia(r(0, 1))).toEqual([
      "Já existia: 1 (1 função). A cópia liga atividades e riscos ao que já existe, sem trocar nome nem CBO.",
    ]);
  });

  it("dois setores, no plural", () => {
    expect(linhasDoQueJaExistia(r(2, 0))[0]).toMatch(/^Já existia: 2 \(2 setores\)\./);
  });
});

describe("a tela da cópia mostra o resumo na prévia e no resultado", () => {
  const tela = readFileSync(join(__dirname, "../../../client/src/pages/CopiarDeOutraFilial.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("as duas vezes, e o que ficou de fora como alerta", () => {
    expect(tela).toMatch(/<JaExistia r=\{previa\} \/>/);
    expect(tela).toMatch(/<JaExistia r=\{resultado\} \/>/);
    expect(tela).toMatch(/r\.de_fora\.length > 0 && \(\s*<div className="form-error" role="alert">/);
  });
});
