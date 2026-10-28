import { formatDay } from "./labels";

/**
 * A situação do curso para quem abre a lista de Treinamentos.
 *
 * O link dizia "Fazer" em todo curso online, sem olhar se a pessoa já o
 * tinha concluído: o Carlos, com o curso feito e válido, achou que estava
 * devendo, e não achou o certificado. [B3-3-B]
 */
export type MinhaInscricao = {
  id: string;
  status: string;
  completedAt: string | null;
  expiresAt: string | null;
};

export type SituacaoNaLista = {
  /** O que a pessoa vê ao lado do link; null quando não há o que dizer. */
  situacao: { texto: string; tom: "success" | "warning" | "danger" | "neutral" } | null;
  link: { texto: string; para: string };
};


export function situacaoNaLista(opcoes: {
  trainingId: string;
  presencial: boolean;
  somenteLeitura: boolean;
  minha: MinhaInscricao | null;
  agora?: Date;
}): SituacaoNaLista {
  const abrir = `/treinamentos/${opcoes.trainingId}`;
  const minha = opcoes.minha;
  const agora = (opcoes.agora ?? new Date()).getTime();

  if (minha?.status === "COMPLETED") {
    /* A validade é um instante (a conclusão mais os meses do curso). */
    const vence = minha.expiresAt;
    if (vence && new Date(vence).getTime() < agora) {
      return {
        situacao: { texto: `Vencido em ${formatDay(vence)}`, tom: "danger" },
        link: { texto: opcoes.presencial ? "Abrir" : "Refazer", para: abrir },
      };
    }
    return {
      situacao: {
        texto: vence ? `Concluído · vale até ${formatDay(vence)}` : "Concluído",
        tom: "success",
      },
      link: { texto: "Ver certificado", para: `/certificados/${minha.id}` },
    };
  }

  if (opcoes.somenteLeitura || opcoes.presencial) {
    return { situacao: null, link: { texto: "Abrir", para: abrir } };
  }
  if (minha?.status === "FAILED") {
    return {
      situacao: { texto: "Não passou na prova", tom: "warning" },
      link: { texto: "Refazer", para: abrir },
    };
  }
  if (minha?.status === "IN_PROGRESS") {
    return {
      situacao: { texto: "Em andamento", tom: "neutral" },
      link: { texto: "Continuar", para: abrir },
    };
  }
  return { situacao: null, link: { texto: "Fazer", para: abrir } };
}
