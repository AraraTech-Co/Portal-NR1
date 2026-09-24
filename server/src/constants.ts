/**
 * Constantes de domínio e de aplicação do portal-nr1.
 *
 * Objetivo: um único lugar para valores fechados (enums da NR-1 / GRO / AEP,
 * limites de upload, documentos obrigatórios do PGR). Controllers e helpers
 * importam daqui em vez de repetir strings mágicas.
 *
 * Os enums Prisma continuam sendo a fonte de verdade no banco; aqui
 * documentamos o significado de cada valor e expomos conjuntos prontos
 * para validação de input da API.
 */

import {
  ActionPriority,
  ActionSourceType,
  ActionStatus,
  AepMethod,
  AepStatus,
  AssessmentStatus,
  ControlStatus,
  ControlType,
  EvidenceType,
  EvidenceValidationStatus,
  HazardCategory,
  HazardOrigin,
  HazardStatus,
  OccurrenceType,
  PgrDocumentType,
  SurveyOutcome,
  SurveyTrigger,
} from "@prisma/client";

// ─── Upload / evidências ─────────────────────────────────────────────────────

/** Tamanho máximo de arquivo de evidência (20 MB). */
export const MAX_EVIDENCE_BYTES = 20 * 1024 * 1024;

/**
 * MIME types aceitos no upload de evidência → extensão gravada no disco.
 * Caminhos ficam privados sob UPLOADS_DIR/{orgId}/evidence/.
 */
export const EVIDENCE_ALLOWED_MIME: Readonly<Record<string, string>> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
  "video/mp4": ".mp4",
};

// ─── PGR (NR-1 1.5.7) ────────────────────────────────────────────────────────

/**
 * Tipos de documento PGR que a organização precisa emitir.
 * Append-only (versão++); emissão exige responsável e declaração de assinatura.
 */
export const REQUIRED_PGR_DOCUMENTS = [
  /** Inventário de riscos — espelho vivo das avaliações validadas. */
  PgrDocumentType.INVENTORY,
  /** Plano de ação — ações abertas/em andamento vinculadas a riscos. */
  PgrDocumentType.ACTION_PLAN,
  /** Critérios de avaliação — metodologia adotada pela organização. */
  PgrDocumentType.CRITERIA,
] as const;

export type RequiredPgrDocument = (typeof REQUIRED_PGR_DOCUMENTS)[number];

/** Prazo máximo padrão de revisão da avaliação (meses), sem certificação SST. */
export const ASSESSMENT_REVIEW_MONTHS_DEFAULT = 24;

// ─── Perigo / risco / avaliação ──────────────────────────────────────────────

/**
 * Natureza do perigo (agrupamento MTE).
 * PSYCHOSOCIAL fica separado de ERGONOMIC na UI/relatórios, embora a norma
 * o trate como subgrupo ergonômico.
 */
export const HAZARD_CATEGORIES = HazardCategory;

/** Situação do perigo no ciclo de vida. */
export const HAZARD_STATUSES = HazardStatus;

/** Origem do registro do perigo. */
export const HAZARD_ORIGINS = HazardOrigin;

/** Status da avaliação de risco (matriz). */
export const ASSESSMENT_STATUSES = AssessmentStatus;

/** Tipo de medida de controle (hierarquia de controles). */
export const CONTROL_TYPES = ControlType;

/** Status da medida de controle. */
export const CONTROL_STATUSES = ControlStatus;

// ─── Ações / evidências ──────────────────────────────────────────────────────

/** Ciclo da ação do plano. Completar exige ≥1 evidência; executor ≠ validador. */
export const ACTION_STATUSES = ActionStatus;

export const ACTION_PRIORITIES = ActionPriority;

/** Origem da ação (FKs explícitas no modelo, não polimórficas). */
export const ACTION_SOURCE_TYPES = ActionSourceType;

export const EVIDENCE_TYPES = EvidenceType;

export const EVIDENCE_VALIDATION_STATUSES = EvidenceValidationStatus;

// ─── AEP — Avaliação Ergonômica Preliminar (NR-17) ───────────────────────────

/**
 * Métodos de condução da AEP.
 * QUESTIONNAIRE exige registrar `anonymityMeasures` (anonimato das respostas).
 */
export const AEP_METHODS = AepMethod;

/** Método padrão ao criar AEP sem `method` no body. */
export const AEP_METHOD_DEFAULT = AepMethod.OBSERVATION;

/** Status da AEP. Concluída não edita — abre-se nova avaliação. */
export const AEP_STATUSES = AepStatus;

/**
 * Mapeia método da AEP → origem do Hazard gerado a partir de um fator.
 * Observação → inspeção; diálogo/questionário → relato de trabalhador.
 */
export const AEP_METHOD_TO_HAZARD_ORIGIN: Readonly<
  Record<AepMethod, HazardOrigin>
> = {
  [AepMethod.OBSERVATION]: HazardOrigin.INSPECTION,
  [AepMethod.INTERVIEW]: HazardOrigin.WORKER_REPORT,
  [AepMethod.QUESTIONNAIRE]: HazardOrigin.WORKER_REPORT,
  [AepMethod.WORKSHOP]: HazardOrigin.WORKER_REPORT,
  [AepMethod.FOCUS_GROUP]: HazardOrigin.WORKER_REPORT,
  /** Combinação de métodos — origem genérica de revisão de rotina. */
  [AepMethod.COMBINED]: HazardOrigin.ROUTINE_REVIEW,
};

// ─── Levantamento preliminar (NR-1 1.5.4.2) ───────────────────────────────────

/**
 * Gatilho do levantamento preliminar.
 * - BEFORE_START: antes de iniciar atividades novas
 * - EXISTING_ACTIVITIES: atividades já em curso
 * - CHANGE_OR_NEW_PROCESS: mudança ou novo processo
 */
export const SURVEY_TRIGGERS = SurveyTrigger;

export const SURVEY_TRIGGER_VALUES: readonly SurveyTrigger[] =
  Object.values(SurveyTrigger);

/**
 * Desfecho de cada item do levantamento (1.5.4.2.1).
 * - HAZARD_AVOIDED: perigo evitado/eliminado
 * - IMMEDIATE_MEASURE: risco evidente + medida imediata (exige measure_taken)
 * - DEFERRED_TO_ACTION_PLAN: sem medida imediata → Hazard + Action
 * - ESCALATED_TO_ASSESSMENT: segue identificação/avaliação completa → Hazard
 */
export const SURVEY_OUTCOMES = SurveyOutcome;

export const SURVEY_OUTCOME_VALUES: readonly SurveyOutcome[] =
  Object.values(SurveyOutcome);

/** Outcomes que criam Hazard (e eventualmente Action) e exigem activity_id. */
export const SURVEY_OUTCOMES_NEEDING_ACTIVITY: readonly SurveyOutcome[] = [
  SurveyOutcome.DEFERRED_TO_ACTION_PLAN,
  SurveyOutcome.ESCALATED_TO_ASSESSMENT,
];

/** Categoria padrão do Hazard quando o body não informa `category`. */
export const HAZARD_CATEGORY_DEFAULT = HazardCategory.ACCIDENT;

/** Prioridade padrão da Action criada por DEFERRED_TO_ACTION_PLAN. */
export const SURVEY_DEFERRED_ACTION_PRIORITY = ActionPriority.HIGH;

// ─── Ocorrências (NR-1 1.5.5.5) ───────────────────────────────────────────────

/**
 * Tipo de ocorrência — análise de acidentes, doenças e eventos perigosos.
 * Infração de grau 4 na NR-28 (capítulo 1.5).
 * - ACCIDENT: acidente de trabalho
 * - OCCUPATIONAL_DISEASE: doença ocupacional
 * - DANGEROUS_EVENT: evento perigoso com potencial de consequência grave (1.5.5.5.1.1)
 */
export const OCCURRENCE_TYPES = OccurrenceType;

export const OCCURRENCE_TYPE_VALUES: readonly OccurrenceType[] =
  Object.values(OccurrenceType);

// ─── Emergências (NR-1 1.5.6) ─────────────────────────────────────────────────

/**
 * Periodicidade padrão sugerida para exercícios simulados (meses),
 * quando o procedimento não informa `drillFrequencyMonths` (1.5.6.3).
 * A norma exige que a periodicidade esteja definida no procedimento —
 * este valor é só fallback de leitura, não substitui o cadastro.
 */
export const EMERGENCY_DRILL_FREQUENCY_MONTHS_DEFAULT = 12;

/**
 * Campos mínimos do procedimento (1.5.6.2 "a"):
 * meios de primeiros socorros / encaminhamento / abandono,
 * responsáveis e plano de evacuação.
 * `largeScaleMeasures` (1.5.6.2 "b") é opcional.
 */
export const EMERGENCY_PROCEDURE_REQUIRED_FIELDS = [
  "first_aid_means",
  "responsibles",
  "evacuation_plan",
] as const;

// ─── Helpers de validação ────────────────────────────────────────────────────

export function isSurveyTrigger(v: string): v is SurveyTrigger {
  return (SURVEY_TRIGGER_VALUES as readonly string[]).includes(v);
}

export function isSurveyOutcome(v: string): v is SurveyOutcome {
  return (SURVEY_OUTCOME_VALUES as readonly string[]).includes(v);
}

export function surveyOutcomeNeedsActivity(outcome: SurveyOutcome): boolean {
  return SURVEY_OUTCOMES_NEEDING_ACTIVITY.includes(outcome);
}

export function isOccurrenceType(v: string): v is OccurrenceType {
  return (OCCURRENCE_TYPE_VALUES as readonly string[]).includes(v);
}

export function isPgrDocumentType(v: string): v is PgrDocumentType {
  return (Object.values(PgrDocumentType) as string[]).includes(v);
}

export function isAepMethod(v: string): v is AepMethod {
  return (Object.values(AepMethod) as string[]).includes(v);
}
