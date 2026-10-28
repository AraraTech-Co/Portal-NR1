/**
 * As partes de Conta e usuários.
 *
 * A página reunia nove seções numa só — sessão, canal, contas, pedidos,
 * links, cadastro em massa, pessoas, comitê e fiscais —, e numa empresa com
 * centenas de pessoas virava uma rolagem sem fim. A sessão fica sempre à
 * vista; o resto se divide em partes, e a parte escolhida vai no endereço,
 * para o Início poder levar direto a ela. [B2-1-I]
 */
export type Parte = "pessoas" | "entrada" | "contas" | "canal" | "fiscalizacao";

export const ROTULO_DA_PARTE: Record<Parte, string> = {
  pessoas: "Pessoas e acessos",
  entrada: "Entrada pelo link",
  contas: "Contas",
  canal: "Canal e comitê",
  fiscalizacao: "Fiscalização",
};

/** Quais partes quem abre vê, na ordem; a primeira é a que abre. */
export function partesDaConta(pode: { gerenciar: boolean; decidirPedidos: boolean }): Parte[] {
  if (pode.gerenciar) return ["pessoas", "entrada", "contas", "canal", "fiscalizacao"];
  if (pode.decidirPedidos) return ["entrada", "contas", "canal"];
  return ["contas", "canal"];
}

/** A parte pedida no endereço, se quem abre pode vê-la; senão, a primeira. */
export function parteAberta(partes: Parte[], pedida: string | null): Parte {
  return partes.find((p) => p === pedida) ?? partes[0];
}
