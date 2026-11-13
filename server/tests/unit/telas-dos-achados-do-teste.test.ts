import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Achados do teste em produção (13/11), na tela. O projeto não tem
 * renderizador de React: o teste lê o `.tsx` sem os comentários — o
 * comentário que explica a correção contém as palavras procuradas.
 */
const semComentarios = (codigo: string) =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const tela = (arquivo: string) =>
  semComentarios(readFileSync(join(__dirname, "../../../client/src/pages", arquivo), "utf8"));

describe("planilha: a linha recusada entra na prévia", () => {
  const importar = tela("ImportPeople.tsx");

  it("a lista de problemas mostra todos, não só os dez primeiros", () => {
    expect(importar).not.toMatch(/problems\.slice\(/);
    expect(importar).toMatch(/lido\.problems\.map\(/);
  });

  it("a conferência guarda as recusadas, e a tabela junta as duas pela linha", () => {
    expect(importar).toMatch(/setRecusadas\(lido\.recusadas\)/);
    expect(importar).toMatch(/\.\.\.recusadas\.map\(/);
    expect(importar).toMatch(/\.sort\(\(a, b\) => a\.linha - b\.linha\)/);
    expect(importar).toMatch(/linhasDaTabela\.map\(/);
    expect(importar).not.toMatch(/mostrado\.results\.map\(\(r\) => \(\s*<tr/);
  });

  it("a contagem de erro da prévia e do relatório soma as recusadas", () => {
    expect(importar).toMatch(/\$\{previa!\.errors \+ recusadas\.length\} com erro/);
    expect(importar).toMatch(/\$\{relatorio\.errors \+ recusadas\.length\} com erro/);
  });
});

describe("troca de senha dá retorno", () => {
  const senha = tela("ChangePasswordPage.tsx");

  it("gravada a senha, a confirmação aparece também na troca obrigatória", () => {
    expect(senha).toMatch(/setPronto\(true\);/);
    expect(senha).not.toMatch(/if \(!obrigado\) setPronto/);
  });

  it("a confirmação toma o lugar do formulário", () => {
    const confirmacao = senha.indexOf("{pronto ? (");
    const formulario = senha.indexOf("<form");
    expect(confirmacao).toBeGreaterThan(-1);
    expect(formulario).toBeGreaterThan(confirmacao);
    expect(senha).toMatch(/Senha trocada\./);
  });
});

describe("o lote mostra a filial de cada página", () => {
  const lote = tela("PayslipBatchSection.tsx");

  it("nas duas listas, a que fica de fora e a que confere", () => {
    expect(lote.match(/\{p\.filial && `\$\{p\.filial\} · `\}/g)).toHaveLength(2);
  });
});

describe("o formulário do atestado segue a regra da rota", () => {
  const atestados = tela("MedicalCertificatesPage.tsx");

  it("a tela lê send_own_modules, não a consulta própria", () => {
    expect(atestados).toMatch(/send_own_modules \?\? \[\]\)\.includes\("atestados"\)/);
    expect(atestados).not.toMatch(/[^_]own_modules \?\? \[\]\)\.includes\("atestados"\)/);
  });
});
