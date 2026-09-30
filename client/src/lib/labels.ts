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

export function formatDay(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

export function isOverdue(
  dueDate: string | Date | null | undefined,
  status: string,
): boolean {
  if (!dueDate) return false;
  if (status === "CLOSED" || status === "CANCELLED" || status === "VALIDATED") {
    return false;
  }
  const d = typeof dueDate === "string" ? new Date(dueDate) : dueDate;
  if (Number.isNaN(d.getTime())) return false;
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  return end.getTime() < Date.now();
}
