/*
  Sem import nenhum: os testes do servidor leem este arquivo direto, como
  fazem com `labels.ts`.
*/

export const DEFAULT_DUTIES = `Cumprir as medidas de prevenção indicadas nesta ordem de serviço.
Usar e conservar os equipamentos de proteção fornecidos pela empresa.
Comunicar ao supervisor qualquer situação de risco, acidente ou quase-acidente.
Colaborar com a organização na aplicação das normas de segurança e saúde.`;

export const DEFAULT_EMERGENCY = `Em caso de acidente ou emergência: interromper a tarefa, acionar o supervisor e seguir o plano de emergência do estabelecimento.`;

export type TextoDaOrdem = {
  duties: string;
  emergency: string;
  /** A versão de onde veio o texto; nula quando é o texto padrão. */
  fromVersion: number | null;
};

/**
 * O texto com que a próxima versão começa.
 *
 * A versão nova vinha sempre com as quatro frases gerais, qualquer que fosse
 * a função: quem emitia para acrescentar um risco podia perder o que a
 * versão anterior pedia ao trabalhador, e ele dava ciência de uma ordem mais
 * pobre que a anterior. Agora a nova começa do texto da vigente; o padrão é
 * só para a primeira. [B3-4-E]
 */
export function textoDaNovaVersao(
  vigente: {
    version: number;
    duties: string;
    emergencyInstructions: string | null;
  } | null,
): TextoDaOrdem {
  if (!vigente) {
    return {
      duties: DEFAULT_DUTIES,
      emergency: DEFAULT_EMERGENCY,
      fromVersion: null,
    };
  }
  return {
    duties: vigente.duties,
    /* A vigente sem instrução de emergência continua sem: foi escolha de quem emitiu. */
    emergency: vigente.emergencyInstructions ?? "",
    fromVersion: vigente.version,
  };
}
