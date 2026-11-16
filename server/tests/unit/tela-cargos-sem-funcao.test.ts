import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * O bloco "Cargos sem função" (Correção 6, C6-2 e C6-3) e a tela de
 * importação que o usa, lidos sem os comentários.
 */
const semComentarios = (codigo: string) =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const ler = (arquivo: string) =>
  semComentarios(readFileSync(join(__dirname, "../../../client/src/pages", arquivo), "utf8"));
const importar = ler("ImportPeople.tsx");
const bloco = ler("CargosSemFuncao.tsx");

describe("a tela de importação usa o bloco", () => {
  it("a conferência guarda os cargos e o aviso do CBO 94; o bloco vem antes da tabela de pessoas", () => {
    expect(importar).toMatch(/setCargosSemFuncao\(lido\.cargosSemFuncao\);/);
    expect(importar).toMatch(/setAvisoCbo94\(lido\.avisoCbo94\);/);
    const oBloco = importar.indexOf("<CargosSemFuncaoBloco");
    const tabela = importar.indexOf("{linhasDaTabela.map(");
    expect(oBloco).toBeGreaterThan(-1);
    expect(tabela === -1 || oBloco < tabela).toBe(true);
  });

  it("só Master e Dono criam: Operação e Conta, lidos sem pular hook", () => {
    expect(importar).toMatch(/const criaFuncoes = editaOperacao && editaConta;/);
    expect(importar).toMatch(/podeCriar=\{criaFuncoes\}/);
    expect(importar).not.toMatch(/useModuleAccess\([^)]*\)\.canWrite && useModuleAccess/);
  });

  it("com todas as linhas de fora, o Conferir funciona e monta a prévia sem ir ao servidor", () => {
    expect(importar).toMatch(/disabled=\{ocupado \|\| \(lido\.rows\.length === 0 && lido\.recusadas\.length === 0\)\}/);
    expect(importar).toMatch(/lido\.rows\.length === 0\s*\?\s*\{ dry_run: true, rows: 0, created: 0, completed: 0, skipped: 0, errors: 0, results: \[\] \}\s*:\s*await enviar\(true\)/);
  });

  it("o resumo do que foi criado continua visível depois que o bloco some", () => {
    expect(importar).toMatch(/onCriado=\{async \(resumo\) => \{\s*setEstruturaCriada\(resumo\);/);
    expect(importar).toMatch(/\{previa && estruturaCriada && \(/);
  });

  it("depois de criar, recarrega as funções e confere de novo sozinha", () => {
    expect(importar).toMatch(/const d = await fetchJobRoles\(\);\s*setFuncoes\(d\.job_roles\);\s*setReconferir\(true\);/);
    expect(importar).toMatch(/if \(!reconferir\) return;\s*setReconferir\(false\);\s*void conferir\(\);/);
  });
});

describe("o bloco", () => {
  it("sem poder criar, mostra o aviso e esconde as ações", () => {
    expect(bloco).toMatch(/\{!podeCriar && \(\s*<p className="import-warning">Quem cuida da Operação \(Master ou Dono\) cria estas funções\.<\/p>/);
    expect(bloco).toMatch(/\{podeCriar && <th>O que fazer<\/th>\}/);
    expect(bloco).toMatch(/\{podeCriar && \(\s*<div className="form-actions">/);
  });

  it("nada vem marcado: o padrão é deixar de fora", () => {
    expect(bloco).toMatch(/\?\? \{ acao: "fora", nome: c\.nome, setor: "", novoSetor: "", juntar: "" \}/);
  });

  it("o setor é obrigatório e nunca escolhido pelo sistema", () => {
    expect(bloco).toMatch(/<option value="">Escolha o setor<\/option>/);
  });

  it("confirma antes de criar, dizendo que as pessoas ainda não são cadastradas", () => {
    expect(bloco).toMatch(/window\.confirm\(/);
    expect(bloco).toMatch(/As pessoas ainda não são cadastradas\./);
  });

  it("CBO diferente entre as linhas avisa, e o CBO 2002 só vai quando é um só", () => {
    expect(bloco).toMatch(/CBO diferente entre as linhas: confira/);
    expect(bloco).toMatch(/\.\.\.\(c\.cbo2002\.length === 1 \? \{ cbo_2002: c\.cbo2002\[0\] \} : \{\}\)/);
  });
});
