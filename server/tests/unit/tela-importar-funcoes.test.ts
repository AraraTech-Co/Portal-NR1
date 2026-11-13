import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * O bloco "Cadastrar setores e funções por planilha" (desenho de 13/11). A
 * tela só lê o arquivo: a prévia e a gravação são do servidor. Lida sem os
 * comentários.
 */
const semComentarios = (codigo: string) =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const ler = (arquivo: string) =>
  semComentarios(readFileSync(join(__dirname, "../../../client/src/pages", arquivo), "utf8"));
const bloco = ler("ImportarFuncoes.tsx");
const operacao = ler("OperationPage.tsx");

describe("setores e funções por planilha na tela", () => {
  it("aparece na Operação só para quem edita", () => {
    expect(operacao).toMatch(/\{canEdit && establishments\.length > 0 && <ImportarFuncoes onDone=\{reload\} \/>\}/);
  });

  it("aceita a filial pelo código da folha e o cargo como função", () => {
    expect(bloco).toMatch(/"cod empresa": "filial"/);
    expect(bloco).toMatch(/cargo: "funcao"/);
  });

  it("confere no servidor antes e só oferece gravar quando algo seria criado", () => {
    expect(bloco).toMatch(/setPrevia\(await enviar\(linhas, true\)\)/);
    expect(bloco).toMatch(/\{previa && previa\.criariam > 0 && \(/);
  });

  it("envia em lotes de 200 e limpa o arquivo depois de gravar", () => {
    expect(bloco).toMatch(/const LOTE = 200;/);
    expect(bloco).toMatch(/key=\{campoDoArquivo\}/);
    expect(bloco).toMatch(/setCampoDoArquivo\(\(n\) => n \+ 1\)/);
  });
});
