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

/*
  Na ordem da NR-1: eliminar, reduzir, proteção coletiva, administrativas,
  EPI. "Engenharia" não dizia a quem é do chão de fábrica que ali entra a
  proteção coletiva: a proteção da máquina foi registrada como EPI e saiu
  assim no inventário e na ordem de serviço. [B3-2-D]
*/
export const CONTROL_TYPE_LABEL: Record<string, string> = {
  ELIMINATION: "Eliminação",
  SUBSTITUTION: "Substituição",
  ENGINEERING: "Proteção coletiva / EPC",
  ADMINISTRATIVE: "Administrativa",
  PPE: "Proteção individual / EPI",
};

/** Uma linha de exemplo para cada tipo de medida, mostrada ao escolher. [B3-2-D] */
export const CONTROL_TYPE_EXAMPLE: Record<string, string> = {
  ELIMINATION: "Tira o perigo do trabalho. Ex.: mudar o processo para não usar o solvente.",
  SUBSTITUTION: "Troca por algo menos perigoso. Ex.: tinta à base de água no lugar da tinta com solvente.",
  ENGINEERING:
    "Protege todos de uma vez, na máquina ou no ambiente. Ex.: proteção móvel com intertravamento, exaustão, guarda-corpo.",
  ADMINISTRATIVE:
    "Regra, procedimento ou organização do trabalho. Ex.: permissão de trabalho, rodízio, sinalização, treinamento.",
  PPE: "Equipamento que cada pessoa usa no corpo. Ex.: luva, protetor auricular, óculos de segurança.",
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
/** Em que pé está o resgate de um prêmio. [OB-4] */
export const REDEMPTION_STATUS_LABEL: Record<string, string> = {
  REQUESTED: "Pedido",
  APPROVED: "Aprovado",
  DELIVERED: "Entregue",
  REJECTED: "Recusado",
};

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

/**
 * Em que pé está a presença de quem foi convocado.
 *
 * A coluna "Minha presença" mostrava o código do banco ("INVITED") a quem
 * tinha sido chamado para a reunião. [CB-64]
 */
export const SUMMON_ATTENDANCE_LABEL: Record<string, string> = {
  INVITED: "Convocado",
  /* Curto: a coluna já se chama "Minha presença", e no celular o rótulo
     longo empurrava a tabela para fora da tela. */
  CONFIRMED: "Confirmada",
  ATTENDED: "Presente",
  ABSENT: "Faltou",
};

/** Tipo do registro de participação. Saía "MEETING" na tela. [B2-1-C] */
export const PARTICIPATION_TYPE_LABEL: Record<string, string> = {
  CONSULTATION: "Consulta aos trabalhadores",
  CIPA_MANIFESTATION: "Manifestação da CIPA",
  MEETING: "Reunião",
  /* A tela vazia citava o DDS, e não havia como registrá-lo. [B3-4-G] */
  SAFETY_DIALOGUE: "DDS (Diálogo Diário de Segurança)",
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

/**
 * Dia e hora, para o que é marcado numa hora — a reunião, a turma.
 *
 * A convocação é marcada em hora cheia e a tela mostrava só o dia: quem foi
 * chamado não sabia a que horas comparecer. Data sem hora (gravada como
 * meia-noite UTC) continua saindo só com o dia — pôr "às 00:00" nela seria
 * inventar uma hora que ninguém marcou. [CB-64]
 */
export function formatDayTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  const semHora =
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0;
  if (semHora) return formatDay(d);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${formatDay(d)} às ${hh}:${mm}`;
}

/**
 * O critério de eficácia tem um nome só em todas as telas. Era "Como saber
 * se deu certo" no formulário e "Critério de eficácia" na validação e no
 * Painel: com dois nomes, ninguém o preencheu. [B3-4-A]
 */
export const CRITERIO_LABEL = "Critério de eficácia";
export const CRITERIO_HINT =
  "Como saber se a ação deu certo. Ex.: zero registros de projeção fora da máquina em 60 dias.";

/**
 * Quem pode mexer no critério, e quando — a mesma regra do servidor. Até a
 * validação, quem cuida do plano; depois, só na ação validada SEM critério,
 * e só quem valida. Cancelada, ninguém. [B3-4-A]
 */
export function podeEditarCriterio(
  status: string,
  temCriterio: boolean,
  cuidaDoPlano: boolean,
  valida: boolean,
): boolean {
  if (status === "CANCELLED") return false;
  if (status === "VALIDATED" || status === "CLOSED") return valida && !temCriterio;
  return cuidaDoPlano;
}

/**
 * O nível que decide prioridade e limite de prazo da ação: o da avaliação
 * MAIS RECENTE, validada ou à espera de validação — a mesma regra do
 * servidor. A substituída não conta. Só o validado valia, e quem avalia não
 * valida a própria avaliação: logo depois de avaliar, a tela dizia "Sem
 * risco avaliado". [B3-2-A]
 */
export function nivelParaPrazo(
  avaliacoes: Array<{
    status: string;
    resultingLevel: string | null;
    assessedAt: string;
  }>,
): { nivel: string; validada: boolean } | null {
  let maisRecente: (typeof avaliacoes)[number] | null = null;
  for (const a of avaliacoes) {
    if (a.status === "SUPERSEDED" || !a.resultingLevel) continue;
    if (!maisRecente || new Date(a.assessedAt) > new Date(maisRecente.assessedAt)) {
      maisRecente = a;
    }
  }
  if (!maisRecente) return null;
  return {
    nivel: maisRecente.resultingLevel!,
    validada: maisRecente.status === "VALIDATED",
  };
}

/** A cor da situação da convocação: a mesma em Convocações e no treinamento. */
export function summonAttendanceTone(
  status: string,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "CONFIRMED" || status === "ATTENDED") return "success";
  if (status === "INVITED") return "warning";
  if (status === "ABSENT") return "danger";
  return "neutral";
}

/**
 * O compromisso marcado já chegou? Marcado só com o dia, ele chega no dia,
 * pelo calendário de quem olha; marcado com hora, chega na hora. A turma
 * marcada às 22h não pode virar "amanhã" por causa do UTC. [B3-3-C]
 */
export function jaChegou(
  value: string | Date,
  agora: Date = new Date(),
): boolean {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return false;
  const semHora =
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0;
  if (!semHora) return d.getTime() <= agora.getTime();
  const hoje = [
    agora.getFullYear(),
    String(agora.getMonth() + 1).padStart(2, "0"),
    String(agora.getDate()).padStart(2, "0"),
  ].join("-");
  return d.toISOString().slice(0, 10) <= hoje;
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

/** "Onde incomoda", na queixa ergonômica: o lugar do corpo, não a frase. O servidor recusa acima disto. [B3-3-D] */
export const ONDE_INCOMODA_MAX = 60;
