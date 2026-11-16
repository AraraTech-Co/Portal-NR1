/**
 * A chave do cargo (Correção 6, C6-1): dois nomes são a mesma função quando
 * a chave é igual. Vale para o cargo da planilha, a função cadastrada e o
 * setor.
 *
 * 1. tira acentos e passa para minúsculas;
 * 2. troca pontuação por espaço e junta espaços repetidos;
 * 3. dobra o gênero, palavra a palavra: "…ora" perde o "a" ("repositora" →
 *    "repositor"); senão, "…a" vira "…o" ("encarregada" → "encarregado").
 *
 * A regra 3 vale dos dois lados: "caixa" vira "caixo" na folha e na função,
 * e as duas continuam casando. Nunca junta por semelhança de digitação nem
 * pelo CBO.
 *
 * A tela tem a mesma função (`client/src/lib/chave-do-cargo.ts`); um
 * teste reprova se as duas divergirem.
 */
export function chaveDoCargo(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((p) => (p.endsWith("ora") ? p.slice(0, -1) : p.endsWith("a") ? `${p.slice(0, -1)}o` : p))
    .join(" ");
}
