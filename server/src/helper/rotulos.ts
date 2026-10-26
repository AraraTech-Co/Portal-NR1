import type { ActionStatus, ParticipationType } from "@prisma/client";

/**
 * Códigos em português, para o texto que o servidor já monta pronto.
 *
 * O Painel da fiscalização é a tela que se mostra ao auditor, e nela saíam
 * "OPEN" e "MEETING" no meio de uma frase em português. Onde o servidor
 * manda o código e a tela traduz, o rótulo fica no cliente; estes dois
 * ficam aqui porque a frase é montada aqui. [B2-1-C]
 */
export const ACTION_STATUS_LABEL: Record<ActionStatus, string> = {
  OPEN: "Aberta",
  IN_PROGRESS: "Em andamento",
  WAITING_VALIDATION: "Aguardando validação",
  VALIDATED: "Validada",
  CLOSED: "Encerrada",
  CANCELLED: "Cancelada",
};

export const PARTICIPATION_TYPE_LABEL: Record<ParticipationType, string> = {
  CONSULTATION: "Consulta aos trabalhadores",
  CIPA_MANIFESTATION: "Manifestação da CIPA",
  MEETING: "Reunião",
  RISK_COMMUNICATION: "Comunicação de risco",
  BASIC_TRAINING: "Treinamento básico",
  WORKSHOP: "Oficina",
};

/**
 * Férias, licença e folga em palavra — o aviso da decisão é escrito pelo
 * servidor e precisa dizer de que pedido se trata. [B3-3-I]
 */
export const LEAVE_KIND_LABEL: Record<string, string> = {
  VACATION: "Férias",
  LEAVE: "Licença",
  DAY_OFF: "Folga",
};
