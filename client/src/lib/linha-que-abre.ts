/**
 * A linha da tabela que abre o registro.
 *
 * Na lista de ocorrências, a linha tinha a mão de clique e mudava de cor,
 * mas só a data abria: quem clicava na descrição achava que a tela não
 * respondia. [B3-2-B]
 *
 * O clique na linha abre, menos quando cai num link ou botão (que já fazem
 * o seu) ou quando a pessoa estava selecionando texto para copiar.
 */
const INTERATIVO = "a, button, input, select, textarea, label, summary";

export function abrePelaLinha(
  alvo: { closest: (seletor: string) => unknown } | null,
  textoSelecionado: string,
): boolean {
  if (textoSelecionado.trim() !== "") return false;
  if (alvo && alvo.closest(INTERATIVO)) return false;
  return true;
}
