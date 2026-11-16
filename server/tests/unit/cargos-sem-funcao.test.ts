import { describe, expect, it } from "vitest";
import {
  CABECALHO_DA_FOLHA,
  lerTabela,
  nomeDeFuncao,
  type CargoSemFuncao,
  type FilialDaEmpresa,
  type FuncaoDaEmpresa,
} from "../../../client/src/lib/planilha";

/**
 * O bloco "Cargos sem função" da prévia (Correção 6, C6-2): os cargos que
 * não casaram, agrupados por filial e chave do cargo. Só mostra: não grava
 * nada. A planilha é fictícia, nos padrões da tabela de cargos da Correção 6:
 * gênero, sem acento, mesmo CBO para funções diferentes, abreviação.
 */
const LOJA: FilialDaEmpresa = { id: "e-loja", name: "Loja", taxId: null, payrollCode: "0682" };
const ADM: FilialDaEmpresa = { id: "e-adm", name: "Administrativo", taxId: null, payrollCode: "0683" };
const FILIAIS = [LOJA, ADM];
const ROTULOS = { papeis: {}, vinculos: { EMPLOYEE: "Empregado" } };

let seq = 0;
function cpf(): string {
  seq += 1;
  const d = String(100000000 + seq * 7919).slice(0, 9).split("").map(Number);
  const dv = (n: number) => {
    const r = (d.slice(0, n).reduce((t, x, i) => t + x * (n + 1 - i), 0) * 10) % 11;
    return r === 10 ? 0 : r;
  };
  d.push(dv(9));
  d.push(dv(10));
  return d.join("");
}

function linha(cod: string, cargo: string, cbo2002: string): string[] {
  seq += 1;
  const valores: Record<string, string> = {
    "Cód. Empresa": cod,
    Competência: "11/2026",
    "Cód. Func.": String(1000 + seq),
    Nome: `PESSOA ${seq}`,
    CPF: cpf(),
    "Data Nasc.": "30827",
    Admissão: "43270",
    Cargo: cargo,
    "CBO 94": "0.11-05",
    "CBO 2002": cbo2002,
  };
  return CABECALHO_DA_FOLHA.map((c) => valores[c] ?? "");
}

const ler = (linhas: string[][], funcoes: FuncaoDaEmpresa[] = []) =>
  lerTabela([[...CABECALHO_DA_FOLHA], ...linhas], funcoes, [], ROTULOS, FILIAIS);

const doBloco = (cargos: CargoSemFuncao[], filial: string, nome: string) =>
  cargos.find((c) => c.filial === filial && c.nome === nome);

describe("o bloco de cargos sem função", () => {
  const lido = ler([
    linha("0682", "REPOSITORA", "5211-25"),
    linha("0682", "REPOSITORA", "5211-25"),
    linha("0682", "REPOSITOR", "5211-25"),
    linha("0682", "CAIXA", "4211-25"),
    linha("0682", "FISCAL DE CAIXA", "4211-25"),
    linha("0682", "ENCARREGADA DE LOJA", "5174-25"),
    linha("0683", "DIRETOR ADMINISTRACAO", "1231-05"),
    linha("0683", "DIRETOR ADMINISTRATIVO", "1231-05"),
    linha("0683", "AUXILIAR FINANCEIRO", "4131-10"),
    linha("0683", "AUXILIAR FINANCEIRO", "4131-11"),
    linha("0683", "", "4110-05"),
  ]);
  const bloco = lido.cargosSemFuncao;

  it("REPOSITORA e REPOSITOR numa linha só, com as duas variações e o nome masculino", () => {
    const rep = bloco.filter((c) => c.filial === "Loja" && c.chave === "repositor");
    expect(rep).toHaveLength(1);
    expect(rep[0]).toMatchObject({
      nome: "Repositor",
      pessoas: 3,
      cbo2002: ["5211-25"],
      variacoes: [
        { grafia: "REPOSITORA", linhas: 2 },
        { grafia: "REPOSITOR", linhas: 1 },
      ],
    });
  });

  it("DIRETOR ADMINISTRACAO e DIRETOR ADMINISTRATIVO separados, cada um sugerindo o outro", () => {
    const a = doBloco(bloco, "Administrativo", "Diretor Administracao")!;
    const b = doBloco(bloco, "Administrativo", "Diretor Administrativo")!;
    expect(a.sugestoes).toEqual(['Mesmo CBO de "DIRETOR ADMINISTRATIVO"']);
    expect(b.sugestoes).toEqual(['Mesmo CBO de "DIRETOR ADMINISTRACAO"']);
  });

  it("CAIXA e FISCAL DE CAIXA separados, com sugestão, e nada marcado", () => {
    expect(doBloco(bloco, "Loja", "Caixa")!.sugestoes).toEqual(['Mesmo CBO de "FISCAL DE CAIXA"']);
    expect(doBloco(bloco, "Loja", "Fiscal de Caixa")!.sugestoes).toEqual(['Mesmo CBO de "CAIXA"']);
  });

  it("sem a grafia masculina, vale a que veio, com inicial maiúscula e conectivo em minúscula", () => {
    expect(doBloco(bloco, "Loja", "Encarregada de Loja")).toBeTruthy();
  });

  it("CBO 2002 diferente entre as linhas do mesmo cargo: os dois aparecem, e não há sugestão", () => {
    const fin = doBloco(bloco, "Administrativo", "Auxiliar Financeiro")!;
    expect(fin.cbo2002).toEqual(["4131-10", "4131-11"]);
    expect(fin.sugestoes).toEqual([]);
  });

  it("cargo vazio não entra no bloco; as linhas com cargo sem função seguem como Erro", () => {
    expect(bloco.every((c) => c.chave !== "")).toBe(true);
    expect(bloco.reduce((t, c) => t + c.pessoas, 0)).toBe(10);
    expect(lido.recusadas.map((r) => r.linha)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(lido.problems[0]).toBe('Linha 2: função "REPOSITORA" não existe na filial "Loja". Veja Cargos sem função, acima.');
  });

  it("função já cadastrada na filial com o mesmo CBO aparece como sugestão", () => {
    const comCaixa = ler(
      [linha("0682", "FISCAL DE CAIXA", "4211-25")],
      [{ id: "f-caixa", name: "Caixa", cbo2002: "4211-25", establishment: { id: LOJA.id, name: LOJA.name } }],
    );
    expect(comCaixa.cargosSemFuncao[0]!.sugestoes).toEqual(['Mesmo CBO da função "Caixa"']);
  });
});

describe("o bloco não mistura filiais nem sugere com CBO divergente", () => {
  const lido = ler([
    linha("0682", "REPOSITOR", "5211-25"),
    linha("0683", "REPOSITORA", "5211-25"),
    linha("0682", "CAIXA", "4211-25"),
    linha("0683", "FISCAL DE CAIXA", "4211-25"),
    linha("0683", "AUXILIAR FINANCEIRO", "4131-10"),
    linha("0683", "AUXILIAR FINANCEIRO", "4131-11"),
    linha("0683", "LIDER FINANCEIRO", "4131-10"),
  ]);
  const bloco = lido.cargosSemFuncao;

  it("o mesmo cargo em duas filiais dá uma linha em cada", () => {
    expect(bloco.filter((c) => c.chave === "repositor").map((c) => c.filial).sort()).toEqual(["Administrativo", "Loja"]);
  });

  it("a sugestão de mesmo CBO não cruza filiais", () => {
    expect(doBloco(bloco, "Loja", "Caixa")!.sugestoes).toEqual([]);
    expect(doBloco(bloco, "Administrativo", "Fiscal de Caixa")!.sugestoes).toEqual([]);
  });

  it("o cargo com CBO divergente entre as linhas não sugere nem é sugerido", () => {
    expect(doBloco(bloco, "Administrativo", "Auxiliar Financeiro")!.sugestoes).toEqual([]);
    expect(doBloco(bloco, "Administrativo", "Lider Financeiro")!.sugestoes).toEqual([]);
  });
});

describe("o nome da função criada (D6-2)", () => {
  it("inicial maiúscula e conectivos em minúscula", () => {
    expect(nomeDeFuncao("ENCARREGADA DE LOJA")).toBe("Encarregada de Loja");
    expect(nomeDeFuncao("LIDER AUX ADMINISTRATIVO RH")).toBe("Lider Aux Administrativo Rh");
    expect(nomeDeFuncao("  auxiliar   de limpeza ")).toBe("Auxiliar de Limpeza");
    expect(nomeDeFuncao("DE MANUTENCAO")).toBe("De Manutencao");
  });
});
