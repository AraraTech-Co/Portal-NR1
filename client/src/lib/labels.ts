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

export const ANNOUNCEMENT_KIND_LABEL: Record<string, string> = {
  NOTICE: "Aviso",
  CAMPAIGN: "Campanha",
  TRAINING: "Treinamento",
};

/** Papéis de organização (Membership.role). */
export const ORG_ROLE_LABEL: Record<string, string> = {
  MASTER: "Master",
  ADMIN: "Admin (legado)",
  SST: "Técnico SST",
  RH: "RH",
  GERENTE: "Gerente",
  ADM_LOJA: "ADM loja",
  SUPERVISOR: "Supervisor",
  COLABORADOR: "Colaborador",
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
