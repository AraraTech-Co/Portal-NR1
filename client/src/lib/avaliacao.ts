/**
 * O que o painel de avaliação mostra e diz, em cada momento.
 *
 * Depois de validar, a tela não dizia nada e mostrava, logo abaixo, o
 * formulário vazio com "Reavaliar": quem validou entendeu que precisava
 * avaliar de novo. Na reavaliação, a prévia "Nível pela matriz: Tolerável"
 * parecia o resultado gravado, e a reavaliação ficou sem gravar. [B3-2-E]
 */
export function painelDaAvaliacao(estado: {
  podeEscrever: boolean;
  temMetodologia: boolean;
  temRascunho: boolean;
  temValidada: boolean;
  reavaliando: boolean;
}): { formulario: boolean; botaoReavaliar: boolean } {
  const livre = estado.podeEscrever && estado.temMetodologia && !estado.temRascunho;
  return {
    formulario: livre && (!estado.temValidada || estado.reavaliando),
    botaoReavaliar: livre && estado.temValidada && !estado.reavaliando,
  };
}

/** A prévia diz que ainda não gravou; o nível vai entre as duas partes. */
export function textoDaPrevia(nivelQueVale: string | null): { antes: string; depois: string } {
  return nivelQueVale
    ? {
        antes: "Ainda não gravado. Se gravar, a reavaliação fica com o nível",
        depois: ` e aguarda validação; até lá, o risco continua ${nivelQueVale}.`,
      }
    : {
        antes: "Ainda não gravado. Se gravar, a avaliação fica com o nível",
        depois: " e aguarda validação.",
      };
}

export function avisoAoGravar(eraReavaliacao: boolean): string {
  return eraReavaliacao
    ? "Reavaliação gravada. Ela passa a valer quando outra pessoa validar; até lá, vale o nível validado."
    : "Avaliação gravada. Ela passa a valer quando outra pessoa validar.";
}

export function avisoAoValidar(nivel: string): string {
  return `Avaliação validada. O risco passa a valer ${nivel}.`;
}

export function rotuloDeGravar(temValidada: boolean, gravando: boolean): string {
  if (gravando) return "Gravando…";
  return temValidada ? "Gravar reavaliação" : "Gravar avaliação";
}
