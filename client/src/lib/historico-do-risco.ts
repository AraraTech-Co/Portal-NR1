/*
  Sem import de "@/": os testes do servidor importam este arquivo direto,
  como fazem com `labels.ts` e `certificado.ts`.
*/
import {
  ACTION_PRIORITY_LABEL,
  ACTION_STATUS_LABEL,
  CONTROL_STATUS_LABEL,
  CONTROL_TYPE_LABEL,
  formatDay,
  HAZARD_CATEGORY_LABEL,
  HAZARD_ORIGIN_LABEL,
  OCCURRENCE_TYPE_LABEL,
  RISK_LEVEL_LABEL,
} from "./labels";

/** Campos que a trilha guarda, com nome de gente. */
export const FIELD_LABEL: Record<string, string> = {
  name: "nome",
  description: "descrição",
  address: "endereço",
  taxId: "CNPJ",
  archivedAt: "arquivado em",
  job_role_ids: "funções",
  level: "nível",
  severity: "severidade",
  probability: "probabilidade",
  priority: "prioridade",
  category: "categoria",
  origin: "origem",
  status: "situação",
  title: "título",
  dueDate: "prazo",
  scopeDescription: "o que foi avaliado",
  methodology: "metodologia",
  implementedAt: "implantada em",
  validatedAt: "validada em",
  type: "tipo",
  /* Apareciam com o nome do campo no banco. [B2-4-E] */
  deadlineJustification: "justificativa do prazo",
  effectivenessCriteria: "critério de eficácia",
  assigneeId: "responsável",
  /* Saíam com o nome do campo no banco na ação validada e no critério
     registrado depois da validação. [B4-A] */
  afterValidation: "registrado depois da validação",
  effectivenessResult: "resultado da eficácia",
  rejectionReason: "motivo da recusa",
  fileName: "arquivo",
  exposedWorkersCount: "trabalhadores expostos",
  occurredAt: "quando aconteceu",
};

/**
 * O valor como gente lê.
 *
 * A trilha guarda o código ("SUBSTANTIAL", "HIGH", "ACCIDENT"), a data em
 * formato de sistema e o identificador interno de pessoas e atividades.
 * Nada disso se lê numa fiscalização. [B2-4-E]
 *
 * Os códigos são procurados em todas as listas de rótulo porque a trilha não
 * diz de que entidade é o campo; na prática eles não se repetem entre
 * listas, e quando se repetem querem dizer a mesma coisa (VALIDATED).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T|$)/;

export function humanValue(raw: unknown): string {
  if (raw == null || raw === "") return "vazio";
  /* "true" não se lê numa fiscalização. [B4-A] */
  if (raw === true) return "sim";
  if (raw === false) return "não";
  if (Array.isArray(raw)) return raw.length === 0 ? "nenhuma" : `${raw.length}`;
  const texto = String(raw);
  if (UUID.test(texto)) return "outro registro";
  if (ISO_DATE.test(texto)) return formatDay(texto);
  for (const mapa of [
    RISK_LEVEL_LABEL,
    ACTION_STATUS_LABEL,
    ACTION_PRIORITY_LABEL,
    HAZARD_CATEGORY_LABEL,
    HAZARD_ORIGIN_LABEL,
    CONTROL_TYPE_LABEL,
    CONTROL_STATUS_LABEL,
    /* "tipo: DANGEROUS_EVENT" em "Ocorrência registrada". [B4-A] */
    OCCURRENCE_TYPE_LABEL,
  ]) {
    if (mapa[texto]) return mapa[texto];
  }
  return texto;
}

export function describeChange(before: unknown, after: unknown): string[] {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return keys
    .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    /*
      Campo que guarda o identificador de outro registro não diz nada a quem
      lê: "activityId: 7f3c…" era ruído, e "activityId: outro registro"
      continua sendo. A atividade já aparece no cabeçalho do risco. [B2-4-E]
    */
    .filter((k) => !/Id$/.test(k))
    /*
      No registro de criação, campo vazio não é informação: "justificativa
      do prazo: vazio" só dizia que o prazo não passou do limite. [B2-4-E]
    */
    .filter((k) => !(before == null && (a[k] == null || a[k] === "")))
    .map((k) => {
      const label = FIELD_LABEL[k] ?? k;
      const from = humanValue(b[k]);
      const to = humanValue(a[k]);
      return before === null || before === undefined ? `${label}: ${to}` : `${label}: ${from} → ${to}`;
    });
}
