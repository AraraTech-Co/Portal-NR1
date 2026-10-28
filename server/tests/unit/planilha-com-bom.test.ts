import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CABECALHO_OFICIAL,
  lerLinhas,
  lerPlanilha,
  type FuncaoDaEmpresa,
} from "../../../client/src/lib/planilha";

/**
 * O arquivo com BOM é lido inteiro.
 *
 * O `TextDecoder` já tira o BOM, e a leitura cortava mais um caractere: a
 * primeira letra do arquivo sumia, "nome" virava "ome", e todas as linhas
 * saíam "sem nome". Acontecia com o próprio modelo baixado do portal — que
 * leva BOM — e com todo "CSV UTF-8" salvo pelo Excel. Achado ao cadastrar
 * pelo arquivo para conferir as fichas de primeiro acesso. [B3-1-B] [S1-G]
 */
const FUNCOES: FuncaoDaEmpresa[] = [
  { id: "f-operador", name: "Operador de máquinas", establishment: { name: "Fábrica Teste Centro" } },
];
const ROTULOS = {
  papeis: { COLABORADOR: "Colaborador" },
  vinculos: { EMPLOYEE: "Empregado" },
};
const BOM = new Uint8Array([0xef, 0xbb, 0xbf]);
const utf8 = (texto: string) => new TextEncoder().encode(texto);
const arquivo = (...partes: Uint8Array[]) => new Blob(partes);

const LINHA = "José Araújo;19;;;Operador de máquinas;Fábrica Teste Centro;01/10/2026;Empregado;;Colaborador";

describe("ler o arquivo da planilha [B3-1-B]", () => {
  it("o modelo do portal, com BOM, chega com o cabeçalho inteiro", async () => {
    const texto = await lerPlanilha(arquivo(BOM, utf8(`${CABECALHO_OFICIAL.join(";")}\r\n${LINHA}\r\n`)));
    expect(texto.startsWith("nome;matricula;")).toBe(true);
    const { rows, problems } = lerLinhas(texto, FUNCOES, [], ROTULOS);
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "José Araújo", registration: "19" });
  });

  it("CSV UTF-8 sem BOM: igual", async () => {
    const texto = await lerPlanilha(arquivo(utf8(`nome;matricula\nJosé Araújo;19\n`)));
    expect(texto).toBe("nome;matricula\nJosé Araújo;19\n");
  });

  it("Excel em Windows-1252: o acento volta certo", async () => {
    const latin = new Uint8Array([...utf8("nome\nJos"), 0xe9, ...utf8("\n")]);
    expect(await lerPlanilha(arquivo(latin))).toBe("nome\nJosé\n");
  });

  it("com BOM, o arquivo é UTF-8 mesmo com um byte estranho: o BOM não vira 'ï»¿' no cabeçalho", async () => {
    const texto = await lerPlanilha(arquivo(BOM, utf8("nome\nJos"), new Uint8Array([0xe9]), utf8("\n")));
    expect(texto.startsWith("nome\n")).toBe(true);
  });

  it("só o BOM sai: nenhuma outra letra do começo", async () => {
    expect(await lerPlanilha(arquivo(BOM, utf8("abc")))).toBe("abc");
    expect(await lerPlanilha(arquivo(utf8("abc")))).toBe("abc");
  });

  it("o modelo baixado continua com BOM, para o Excel abrir os acentos", () => {
    const tela = readFileSync(join(__dirname, "..", "..", "..", "client", "src", "pages", "ImportPeople.tsx"), "utf8");
    expect(tela).toContain("new Blob([`\\ufeff${MODELO}\\r\\n`]");
    expect(tela).toContain("setTexto(await lerPlanilha(f));");
  });
});
