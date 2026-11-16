/**
 * O aviso das linhas da planilha que ficam de fora, na prévia e no
 * resultado, com o verbo concordando com a quantidade. [C6-9]
 */
export function avisoDasLinhasDeFora(
  quantidade: number,
  jaCadastrou: boolean,
): { titulo: string; resto: string } {
  if (quantidade === 1) {
    return {
      titulo: "1 linha da planilha fica de fora",
      resto: `e não ${jaCadastrou ? "foi cadastrada" : "será cadastrada"}. Está na tabela abaixo como Erro, com o motivo.`,
    };
  }
  return {
    titulo: `${quantidade} linhas da planilha ficam de fora`,
    resto: `e não ${jaCadastrou ? "foram cadastradas" : "serão cadastradas"}. Estão na tabela abaixo como Erro, com o motivo.`,
  };
}
