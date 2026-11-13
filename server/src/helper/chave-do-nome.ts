/**
 * A chave com que nomes de filial, setor e função são comparados: sem
 * acento, sem maiúsculas e sem espaço nas pontas.
 *
 * É EXATAMENTE a `semAcento` da planilha de pessoas
 * (`client/src/lib/planilha.ts`), que casa o cargo com a função pelo nome
 * dentro da filial. Se as duas divergirem, a importação de funções cria
 * "Caixa" ao lado de "CAIXA" e a planilha de pessoas recusa as duas como
 * ambíguas. Um teste compara as duas. (desenho de 13/11)
 */
export function chaveDoNome(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}
