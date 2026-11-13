import { describe, expect, it } from "vitest";
import { chaveDoNome } from "../../src/helper/chave-do-nome";
import { semAcento } from "../../../client/src/lib/planilha";

/**
 * A importação de funções e a planilha de pessoas comparam nomes com a
 * MESMA chave: se divergirem, a importação cria "Caixa" ao lado de "CAIXA"
 * e a planilha de pessoas recusa as duas como ambíguas (desenho de 13/11).
 */
const GRAFIAS = [
  "CAIXA",
  "Caixa",
  " caixa ",
  "AUXILIAR ADMINISTRATIVO",
  "auxiliar administrativo",
  "Função de Saúde",
  "FUNÇÃO DE SAÚDE",
  "Líder de Cadastro",
  "LIDER DE CADASTRO",
  "Ação  dupla",
  "Ñandu ÇÃÕ éèê",
  "",
];

describe("a chave do nome é a mesma nos dois lados", () => {
  it("dá o mesmo resultado que a semAcento da planilha em todas as grafias", () => {
    for (const g of GRAFIAS) expect(chaveDoNome(g), JSON.stringify(g)).toBe(semAcento(g));
  });

  it("junta o que a planilha de pessoas junta", () => {
    expect(chaveDoNome("Caixa ")).toBe(chaveDoNome("CAIXA"));
    expect(chaveDoNome("LIDER DE CADASTRO")).toBe(chaveDoNome("Líder de Cadastro"));
  });
});
