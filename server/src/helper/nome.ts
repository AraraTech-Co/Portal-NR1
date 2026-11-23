/**
 * "ANA  DA SILVA" e "Ana da Silva" são o mesmo nome: sem acento, sem
 * diferença de maiúscula e com os espaços normalizados. A folha escreve em
 * maiúsculas; a filial é comparada do mesmo jeito. Uma regra só.
 */
export function nomeNormalizado(x: string): string {
  return x
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function mesmoNome(a: string, b: string): boolean {
  return nomeNormalizado(a) === nomeNormalizado(b);
}
