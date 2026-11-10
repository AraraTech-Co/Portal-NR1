import { describe, expect, it } from "vitest";
import {
  CABECALHO_OFICIAL,
  lerLinhas,
  type FilialDaEmpresa,
  type FuncaoDaEmpresa,
} from "../../../client/src/lib/planilha";

/**
 * A planilha diz a filial de cada pessoa. [C3-3]
 *
 * A Americana tem a loja e a AG com funções de mesmo nome e matrículas que
 * se repetem entre elas. A coluna "filial" aceita o nome ou o CNPJ, e a
 * função é procurada dentro da filial da linha.
 */
const LOJA: FilialDaEmpresa = { id: "e-loja", name: "Loja Centro", taxId: "12345678000190" };
const AG: FilialDaEmpresa = { id: "e-ag", name: "AG Administrativo", taxId: "98765432000110" };
const FUNCOES: FuncaoDaEmpresa[] = [
  { id: "f-vend-loja", name: "Vendedor", establishment: { id: LOJA.id, name: LOJA.name } },
  { id: "f-vend-ag", name: "Vendedor", establishment: { id: AG.id, name: AG.name } },
];
const ROTULOS = { papeis: {}, vinculos: {} };

const ler = (texto: string, filiais: FilialDaEmpresa[] = [LOJA, AG]) =>
  lerLinhas(texto, FUNCOES, [], ROTULOS, filiais);

describe('a coluna "filial" [C3-3]', () => {
  it("é a do modelo, no lugar de unidade", () => {
    expect(CABECALHO_OFICIAL).toContain("filial");
    expect(CABECALHO_OFICIAL).not.toContain("unidade");
  });

  it("pelo nome, a linha leva a filial e a função daquela filial", () => {
    const { rows, problems } = ler("nome;matricula;funcao;filial\nAna;153;Vendedor;ag administrativo");
    expect(problems).toEqual([]);
    expect(rows[0]).toMatchObject({ establishment_id: AG.id, job_role_id: "f-vend-ag" });
  });

  it("pelo CNPJ, com ou sem pontuação", () => {
    const { rows, problems } = ler(
      "nome;funcao;filial\nAna;Vendedor;12.345.678/0001-90\nBia;Vendedor;98765432000110",
    );
    expect(problems).toEqual([]);
    expect(rows.map((r) => [r.establishment_id, r.job_role_id])).toEqual([
      [LOJA.id, "f-vend-loja"],
      [AG.id, "f-vend-ag"],
    ]);
  });

  it('o cabeçalho antigo "unidade" continua valendo', () => {
    const { rows } = ler("nome;funcao;unidade\nAna;Vendedor;Loja Centro");
    expect(rows[0]).toMatchObject({ establishment_id: LOJA.id, job_role_id: "f-vend-loja" });
  });

  it("filial que não existe é avisada e a linha não vai", () => {
    const { rows, problems } = ler("nome;filial\nAna;Loja Norte");
    expect(rows).toEqual([]);
    expect(problems.join(" ")).toContain('filial "Loja Norte" não existe');
  });

  it("com mais de uma filial, a linha sem filial é avisada e não vai", () => {
    const { rows, problems } = ler("nome;matricula\nAna;153");
    expect(rows).toEqual([]);
    expect(problems.join(" ")).toContain("informe a filial");
  });

  it("com uma filial só, a coluna pode faltar", () => {
    const { rows, problems } = ler("nome;matricula\nAna;153", [LOJA]);
    expect(problems).toEqual([]);
    expect(rows[0]!.establishment_id).toBeUndefined();
  });
});
