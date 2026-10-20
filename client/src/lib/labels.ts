export const ACTION_STATUS_LABEL: Record<string, string> = {
  OPEN: "Aberta",
  IN_PROGRESS: "Em andamento",
  WAITING_VALIDATION: "Aguardando validação",
  VALIDATED: "Validada",
  CLOSED: "Encerrada",
  CANCELLED: "Cancelada",
};

export const ACTION_PRIORITY_LABEL: Record<string, string> = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
  CRITICAL: "Crítica",
};

/** De onde veio a ação. "MANUAL" aparecia cru na coluna Origem. [B2-1-C] */
export const ACTION_SOURCE_LABEL: Record<string, string> = {
  RISK: "Risco",
  CHANGE_EVENT: "Mudança na operação",
  OCCURRENCE: "Ocorrência",
  AUDIT: "Auditoria",
  LEGAL_REQUIREMENT: "Exigência legal",
  MANUAL: "Aberta à mão",
};

export const RISK_LEVEL_LABEL: Record<string, string> = {
  TRIVIAL: "Trivial",
  TOLERABLE: "Tolerável",
  MODERATE: "Moderado",
  SUBSTANTIAL: "Substancial",
  INTOLERABLE: "Intolerável",
};

export const HAZARD_CATEGORY_LABEL: Record<string, string> = {
  PHYSICAL: "Físico",
  CHEMICAL: "Químico",
  BIOLOGICAL: "Biológico",
  ERGONOMIC: "Ergonômico",
  PSYCHOSOCIAL: "Psicossocial",
  ACCIDENT: "Acidente",
};

export const HAZARD_ORIGIN_LABEL: Record<string, string> = {
  INSPECTION: "Inspeção",
  WORKER_REPORT: "Relato de trabalhador",
  INCIDENT: "Ocorrência",
  ROUTINE_REVIEW: "Revisão de rotina",
  AI_SUGGESTION: "Sugestão automática",
  OTHER: "Outra",
};

export const CONTROL_TYPE_LABEL: Record<string, string> = {
  ELIMINATION: "Eliminação",
  SUBSTITUTION: "Substituição",
  ENGINEERING: "Engenharia",
  ADMINISTRATIVE: "Administrativa",
  PPE: "EPI",
};

export const CONTROL_STATUS_LABEL: Record<string, string> = {
  PLANNED: "Planejada",
  IMPLEMENTED: "Implantada",
  INEFFECTIVE: "Ineficaz",
  REMOVED: "Removida",
};

export const OCCURRENCE_TYPE_LABEL: Record<string, string> = {
  ACCIDENT: "Acidente",
  OCCUPATIONAL_DISEASE: "Doença relacionada ao trabalho",
  DANGEROUS_EVENT: "Quase aconteceu algo grave",
};

export const REPORT_CATEGORY_LABEL: Record<string, string> = {
  HARASSMENT_MORAL: "Assédio moral",
  HARASSMENT_SEXUAL: "Assédio sexual",
  DISCRIMINATION: "Discriminação",
  MISCONDUCT: "Conduta inadequada",
  FRAUD_OR_MISUSE: "Fraude ou mau uso",
  DATA_LEAK: "Vazamento de dados",
  SAFETY_RISK: "Risco à segurança",
  OTHER: "Outro",
};

export const REPORT_STATUS_LABEL: Record<string, string> = {
  RECEIVED: "Recebido",
  IN_ANALYSIS: "Em análise",
  AWAITING_INFO: "Aguardando o denunciante",
  RESOLVED: "Resolvido",
  ARCHIVED: "Arquivado",
};

export const ANNOUNCEMENT_KIND_LABEL: Record<string, string> = {
  NOTICE: "Aviso",
  CAMPAIGN: "Campanha",
  TRAINING: "Treinamento",
};

/** Papéis de organização (Membership.role). */
export const ORG_ROLE_LABEL: Record<string, string> = {
  MASTER: "Master (todas as contas)",
  /** Dono de uma conta; MASTER alcança todas as contas da empresa. [OB-3] */
  OWNER: "Dono da conta",
  ADMIN: "Admin (legado)",
  SST: "Técnico SST",
  RH: "RH",
  GERENTE: "Gerente",
  ADM_LOJA: "ADM loja",
  SUPERVISOR: "Supervisor",
  COLABORADOR: "Colaborador",
  FISCAL: "Fiscal (só consulta)",
};


/** Chaves efetivas de permissão (sessão). */
export const PERMISSION_LABEL: Record<string, string> = {
  master: "Master",
  owner: "Owner",
  adm_loja: "ADM loja",
  admin: "Admin",
  sst: "Técnico SST",
  rh: "RH",
  supervisor: "Supervisor",
  gerente: "Gerente",
  colaborador: "Colaborador",
  fiscal: "Fiscal (só consulta)",
  user: "Colaborador",
};

type CalendarDay = { year: number; month: number; day: number };

/**
 * Dia de calendário de um valor de data.
 *
 * Data sem hora (admissão, prazo, início do atestado) é gravada como
 * meia-noite UTC. Lida no fuso local (-03:00), vira 21h do dia ANTERIOR. Por
 * isso meia-noite UTC exata é tratada como data de calendário; qualquer outro
 * instante é lido no fuso de quem olha. [S3-B]
 */
function calendarDay(value: string | Date | null | undefined): CalendarDay | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  const meiaNoiteUtc =
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0;
  return meiaNoiteUtc
    ? { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() }
    : { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
}

/*
  Mais três listas com código na tela, achadas ao abrir as telas que só
  listavam — a varredura anterior não as viu porque o banco local não tinha
  nenhum registro nelas. [B2-1-C] [OB-4]
*/
export const IDEA_STATUS_LABEL: Record<string, string> = {
  NEW: "Nova",
  IN_ANALYSIS: "Em análise",
  IMPLEMENTED: "Implantada",
  REJECTED: "Recusada",
};

export const REFERRAL_STATUS_LABEL: Record<string, string> = {
  RECEIVED: "Recebida",
  IN_PROCESS: "Em processo",
  HIRED: "Contratado",
  DISCARDED: "Descartada",
};

export const HR_DOCUMENT_KIND_LABEL: Record<string, string> = {
  CONTRACT: "Contrato",
  WARNING: "Advertência",
  NOTICE: "Comunicado",
  RECEIPT: "Recibo",
  TERM: "Termo",
  OTHER: "Outro",
};

/** Como a avaliação ergonômica foi feita. Saía "OBSERVATION". [B2-1-C] */
export const AEP_METHOD_LABEL: Record<string, string> = {
  OBSERVATION: "Observação do trabalho",
  INTERVIEW: "Entrevista",
  QUESTIONNAIRE: "Questionário",
  WORKSHOP: "Oficina",
  FOCUS_GROUP: "Grupo focal",
  COMBINED: "Métodos combinados",
};

export const AEP_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Em andamento",
  CONCLUDED: "Concluída",
};

/** Pesquisa de clima: saía "OPEN" na coluna de situação. [B2-1-C] */
export const SURVEY_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Rascunho",
  OPEN: "Aberta para respostas",
  CLOSED: "Encerrada",
};

/** Tipo do registro de participação. Saía "MEETING" na tela. [B2-1-C] */
export const PARTICIPATION_TYPE_LABEL: Record<string, string> = {
  CONSULTATION: "Consulta aos trabalhadores",
  CIPA_MANIFESTATION: "Manifestação da CIPA",
  MEETING: "Reunião",
  RISK_COMMUNICATION: "Comunicação de risco",
  BASIC_TRAINING: "Treinamento básico",
  WORKSHOP: "Oficina",
};

/** O que a função exige. Saía "EXAM" na tela de Saúde. [B2-1-C] */
export const REQUIREMENT_KIND_LABEL: Record<string, string> = {
  CERTIFICATE: "Certificado",
  EXAM: "Exame",
  TRAINING: "Treinamento",
};

export const ENROLLMENT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Inscrito",
  IN_PROGRESS: "Em andamento",
  COMPLETED: "Concluído",
  /// Fez a prova e não alcançou a nota mínima — pode refazer. [S4-K]
  FAILED: "Não passou",
};

export const CERTIFICATE_STATUS_LABEL: Record<string, string> = {
  PENDING: "Em análise",
  APPROVED: "Aceito",
  REJECTED: "Recusado",
};

export const EXAM_KIND_LABEL: Record<string, string> = {
  ADMISSIONAL: "Admissional",
  PERIODIC: "Periódico",
  RETURN_TO_WORK: "Retorno ao trabalho",
  ROLE_CHANGE: "Mudança de função",
  DISMISSAL: "Demissional",
};

export function formatDay(value: string | Date | null | undefined): string {
  const c = calendarDay(value);
  if (!c) return "—";
  const dd = String(c.day).padStart(2, "0");
  const mm = String(c.month + 1).padStart(2, "0");
  return `${dd}/${mm}/${c.year}`;
}

export function isOverdue(
  dueDate: string | Date | null | undefined,
  status: string,
): boolean {
  if (!dueDate) return false;
  if (status === "CLOSED" || status === "CANCELLED" || status === "VALIDATED") {
    return false;
  }
  const c = calendarDay(dueDate);
  if (!c) return false;
  // Vence no FIM do dia do prazo, no fuso de quem olha — não às 21h da véspera.
  const end = new Date(c.year, c.month, c.day, 23, 59, 59, 999);
  return end.getTime() < Date.now();
}

/** Férias e licenças apareciam em código na tela: "VACATION", "APPROVED". [S5-D] [CB-32] */
export const LEAVE_KIND_LABEL: Record<string, string> = {
  VACATION: "Férias",
  LEAVE: "Licença",
  DAY_OFF: "Folga",
};

export const LEAVE_STATUS_LABEL: Record<string, string> = {
  REQUESTED: "Aguardando decisão",
  APPROVED: "Aprovado",
  REJECTED: "Recusado",
  CANCELLED: "Cancelado",
};
