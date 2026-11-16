import { describe, expect, it } from "vitest";
import { chaveDoCargo } from "../../src/helper/chave-do-cargo";
import { chaveDoCargo as chaveDaTela } from "../../../client/src/lib/chave-do-cargo";
import { lerLinhas, type FilialDaEmpresa, type FuncaoDaEmpresa } from "../../../client/src/lib/planilha";

/** A chave do cargo e o casamento da planilha por ela. [C6-1] */
const PARES_IGUAIS: [string, string][] = [
  ["Repositor", "REPOSITORA"],
  ["Supervisor Geral", "SUPERVISORA GERAL"],
  ["Diretor Administração", "DIRETOR ADMINISTRACAO"],
  ["Líder de Cadastro", "LIDER DE CADASTRO"],
  ["Encarregado de Loja", "ENCARREGADA DE LOJA"],
  ["Auxiliar Administrativo", "Auxiliar Administrativa"],
  ["Caixa", "CAIXA"],
  ["Op. Caixa", "OP CAIXA"],
  ["Auxiliar  de   Limpeza", "auxiliar de limpeza"],
];
const PARES_DIFERENTES: [string, string][] = [
  ["Caixa", "COM OP CAIXA"],
  ["Caixa", "Fiscal de Caixa"],
  ["Operador de Caixa I", "Operador de Caixa II"],
  ["Gerente", "Subgerente"],
  ["Diretor Administração", "DIRETOR ADMINISTRATIVO"],
  ["Faxineira", "Auxiliar de Limpeza"],
];

describe("a chave do cargo", () => {
  it("junta as grafias do mesmo cargo: gênero, acento, pontuação e espaços", () => {
    for (const [a, b] of PARES_IGUAIS) expect(chaveDoCargo(a), `${a} | ${b}`).toBe(chaveDoCargo(b));
  });

  it("não junta cargos diferentes, nem por semelhança de digitação", () => {
    for (const [a, b] of PARES_DIFERENTES) expect(chaveDoCargo(a), `${a} | ${b}`).not.toBe(chaveDoCargo(b));
  });

  it("a cópia da tela e a do servidor dão o mesmo resultado em todas as grafias", () => {
    const todas = [...PARES_IGUAIS, ...PARES_DIFERENTES].flat().concat(["", "  ", "Ñandu-ÇÃO", "Técnica 2", "Copeira/Copeiro"]);
    for (const g of todas) expect(chaveDaTela(g), JSON.stringify(g)).toBe(chaveDoCargo(g));
  });
});

describe("a planilha casa o cargo pela chave, dentro da filial", () => {
  const LOJA: FilialDaEmpresa = { id: "e-loja", name: "Loja", taxId: null, payrollCode: null };
  const AG: FilialDaEmpresa = { id: "e-ag", name: "AG", taxId: null, payrollCode: null };
  const f = (id: string, name: string, filial: FilialDaEmpresa): FuncaoDaEmpresa => ({
    id,
    name,
    establishment: { id: filial.id, name: filial.name },
  });
  const ler = (funcoes: FuncaoDaEmpresa[], linhas: string) =>
    lerLinhas(`nome;funcao;filial\n${linhas}`, funcoes, [], { papeis: {}, vinculos: {} }, [LOJA, AG]);

  it("REPOSITORA casa com Repositor; SUPERVISORA GERAL com Supervisor Geral; DIRETOR ADMINISTRACAO com Diretor Administração", () => {
    const funcoes = [
      f("f-rep", "Repositor", LOJA),
      f("f-sup", "Supervisor Geral", LOJA),
      f("f-dir", "Diretor Administração", LOJA),
    ];
    const lido = ler(funcoes, "Ana;REPOSITORA;Loja\nBia;SUPERVISORA GERAL;Loja\nCaio;DIRETOR ADMINISTRACAO;Loja");
    expect(lido.problems).toEqual([]);
    expect(lido.rows.map((r) => r.job_role_id)).toEqual(["f-rep", "f-sup", "f-dir"]);
  });

  it("COM OP CAIXA não casa com Caixa", () => {
    const lido = ler([f("f-caixa", "Caixa", LOJA)], "Ana;COM OP CAIXA;Loja");
    expect(lido.rows).toEqual([]);
    expect(lido.problems[0]).toContain('função "COM OP CAIXA" não existe na filial "Loja"');
  });

  it("Repositor e Repositora na mesma filial: a linha fica de fora, com a mensagem nova", () => {
    const lido = ler([f("f-1", "Repositor", LOJA), f("f-2", "Repositora", LOJA)], "Ana;REPOSITORA;Loja");
    expect(lido.rows).toEqual([]);
    expect(lido.problems).toEqual([
      'Linha 2: há duas funções equivalentes a "REPOSITORA" nesta filial (Repositor e Repositora). Arquive uma em Operação e confira de novo.',
    ]);
  });

  it("a mesma função em outra filial não atrapalha: casa a da filial da linha", () => {
    const lido = ler([f("f-loja", "Repositor", LOJA), f("f-ag", "Repositora", AG)], "Ana;REPOSITORA;AG");
    expect(lido.rows.map((r) => r.job_role_id)).toEqual(["f-ag"]);
  });
});
