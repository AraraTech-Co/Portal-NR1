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
  AnnouncementKind,
  AssessmentStatus,
  CertificateStatus,
  ControlStatus,
  ControlType,
  ContractorRelation,
  EnrollmentStatus,
  EvidenceType,
  EvidenceValidationStatus,
  ExamKind,
  HazardCategory,
  HazardOrigin,
  HazardStatus,
  HrDocumentKind,
  IdeaStatus,
  LeaveKind,
  LeaveStatus,
  OccurrenceType,
  ParticipationType,
  PgrDocumentType,
  RedemptionStatus,
  ReferralStatus,
  ReportAuthorSide,
  ReportCategory,
  ReportStatus,
  RequirementKind,
  SummonAttendanceStatus,
  SurveyOutcome,
  SurveyStatus,
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

// ─── Terceiros (NR-1 1.5.8) ───────────────────────────────────────────────────

/**
 * Relação contratual com a organização.
 * - WE_HIRE: somos contratante — recebemos inventário/plano da contratada (1.5.8.1.1)
 * - WE_ARE_HIRED: somos contratada — fornecemos nosso inventário à contratante
 */
export const CONTRACTOR_RELATIONS = ContractorRelation;

export const CONTRACTOR_RELATION_VALUES: readonly ContractorRelation[] =
  Object.values(ContractorRelation);

/** Relação padrão ao criar terceiro sem `relation` no body. */
export const CONTRACTOR_RELATION_DEFAULT = ContractorRelation.WE_HIRE;

// ─── Participação dos trabalhadores (NR-1 1.5.3.3 / 1.5.5.3.2 "d") ───────────

/**
 * Tipo de registro de participação/consulta.
 * Na fiscalização, demonstra que os trabalhadores foram ouvidos e informados —
 * o documento sozinho não basta; evidências anexas reforçam o registro.
 * - CONSULTATION: consulta formal aos trabalhadores
 * - CIPA_MANIFESTATION: manifestação / atuação da CIPA
 * - MEETING: reunião de SST / DDS
 * - RISK_COMMUNICATION: comunicação de riscos
 * - BASIC_TRAINING: capacitação básica vinculada à participação
 * - WORKSHOP: oficina / workshop
 */
export const PARTICIPATION_TYPES = ParticipationType;

export const PARTICIPATION_TYPE_VALUES: readonly ParticipationType[] =
  Object.values(ParticipationType);

// ─── Canal de denúncia (Lei 14.457/2022, art. 23, II) ─────────────────────────

/**
 * Categoria do relato.
 * - HARASSMENT_MORAL / HARASSMENT_SEXUAL: assédio
 * - DISCRIMINATION: discriminação
 * - MISCONDUCT: conduta inadequada
 * - FRAUD_OR_MISUSE: fraude / mau uso
 * - DATA_LEAK: vazamento de dados
 * - SAFETY_RISK: risco de segurança (pode virar Hazard no GRO)
 * - OTHER: outros
 */
export const REPORT_CATEGORIES = ReportCategory;

export const REPORT_CATEGORY_VALUES: readonly ReportCategory[] =
  Object.values(ReportCategory);

/**
 * Status do relato no fluxo do comitê.
 * RECEIVED → IN_ANALYSIS → AWAITING_INFO → RESOLVED | ARCHIVED
 */
export const REPORT_STATUSES = ReportStatus;

export const REPORT_STATUS_VALUES: readonly ReportStatus[] =
  Object.values(ReportStatus);

/** Lado da mensagem no histórico (ADR-16). */
export const REPORT_AUTHOR_SIDES = ReportAuthorSide;

/**
 * Prefixo do protocolo público (ex.: CX-7232).
 * O código de acesso em claro só é devolvido uma vez na criação.
 */
export const ETHICS_PROTOCOL_PREFIX = "CX";

/** Tamanho do código de acompanhamento em claro (antes do bcrypt). */
export const ETHICS_ACCESS_CODE_LENGTH = 10;

/** Custo bcrypt do hash do código de acesso. */
export const ETHICS_ACCESS_CODE_BCRYPT_ROUNDS = 10;

// ─── RH / perfil do colaborador ──────────────────────────────────────────────

/**
 * Normaliza CPF/CNPJ para só dígitos (NR-7 7.5.19.1 b — chave de saúde).
 * Retorna null se vazio; lança 400 se houver caracteres não numéricos misturados
 * de forma inválida após strip (já só dígitos).
 */
export function normalizeTaxIdDigits(raw?: string | null): string | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return null;
  }
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.length !== 11 && digits.length !== 14) {
    throw Object.assign(
      new Error("tax_id deve ter 11 (CPF) ou 14 (CNPJ) dígitos."),
      { status: 400 },
    );
  }
  return digits;
}

// ─── Ideias (caixa de sugestões) ─────────────────────────────────────────────

/**
 * Status da ideia enviada pelo colaborador.
 * - NEW: recém-enviada
 * - IN_ANALYSIS: em análise pelo RH/gestão
 * - IMPLEMENTED: adotada
 * - REJECTED: recusada (exige decision_note)
 */
export const IDEA_STATUSES = IdeaStatus;

export const IDEA_STATUS_VALUES: readonly IdeaStatus[] =
  Object.values(IdeaStatus);

/** Status finais que exigem decision_note. */
export const IDEA_STATUSES_NEEDING_NOTE: readonly IdeaStatus[] = [
  IdeaStatus.IMPLEMENTED,
  IdeaStatus.REJECTED,
];

// ─── Mural de avisos ─────────────────────────────────────────────────────────

/**
 * Tipo de aviso no mural.
 * - NOTICE: comunicado geral
 * - CAMPAIGN: campanha
 * - TRAINING: capacitação / treino (leitura prova comunicação — NR-1 / Lei 14.457)
 */
export const ANNOUNCEMENT_KINDS = AnnouncementKind;

export const ANNOUNCEMENT_KIND_VALUES: readonly AnnouncementKind[] =
  Object.values(AnnouncementKind);

/** Kind padrão ao criar aviso sem `kind` no body. */
export const ANNOUNCEMENT_KIND_DEFAULT = AnnouncementKind.NOTICE;

// ─── Documentos de RH ────────────────────────────────────────────────────────

/**
 * Tipo de documento RH publicado para ciência.
 * - CONTRACT, WARNING, NOTICE, RECEIPT, TERM, OTHER
 */
export const HR_DOCUMENT_KINDS = HrDocumentKind;

export const HR_DOCUMENT_KIND_VALUES: readonly HrDocumentKind[] =
  Object.values(HrDocumentKind);

export const HR_DOCUMENT_KIND_DEFAULT = HrDocumentKind.OTHER;

// ─── Atestados / certificados (reusa CertificateStatus) ───────────────────────

/**
 * Status de atestado médico ou certificado do trabalhador.
 * PENDING → APPROVED | REJECTED
 */
export const CERTIFICATE_STATUSES = CertificateStatus;

export const CERTIFICATE_STATUS_VALUES: readonly CertificateStatus[] =
  Object.values(CertificateStatus);

// ─── Férias / licenças ───────────────────────────────────────────────────────

export const LEAVE_KINDS = LeaveKind;
export const LEAVE_KIND_VALUES: readonly LeaveKind[] = Object.values(LeaveKind);
export const LEAVE_KIND_DEFAULT = LeaveKind.VACATION;

export const LEAVE_STATUSES = LeaveStatus;
export const LEAVE_STATUS_VALUES: readonly LeaveStatus[] =
  Object.values(LeaveStatus);

// ─── Convocações ─────────────────────────────────────────────────────────────

/**
 * Presença em convocação (reunião, DDS, treinamento presencial).
 * INVITED → CONFIRMED → ATTENDED | ABSENT
 */
export const SUMMON_ATTENDANCE_STATUSES = SummonAttendanceStatus;

export const SUMMON_ATTENDANCE_STATUS_VALUES: readonly SummonAttendanceStatus[] =
  Object.values(SummonAttendanceStatus);

// ─── Treinamentos ────────────────────────────────────────────────────────────

/** Status da matrícula no treinamento online. */
export const ENROLLMENT_STATUSES = EnrollmentStatus;

export const ENROLLMENT_STATUS_VALUES: readonly EnrollmentStatus[] =
  Object.values(EnrollmentStatus);

/**
 * Tipo de exigência por função (CNH, ASO, treinamento, etc.).
 */
export const REQUIREMENT_KINDS = RequirementKind;

export const REQUIREMENT_KIND_VALUES: readonly RequirementKind[] =
  Object.values(RequirementKind);

/** Tipo de exame ocupacional (NR-7 / ASO). */
export const EXAM_KINDS = ExamKind;
export const EXAM_KIND_VALUES: readonly ExamKind[] = Object.values(ExamKind);
export const EXAM_KIND_DEFAULT = ExamKind.PERIODIC;

/** Status de pesquisa de clima / ciclo de avaliação 360. */
export const SURVEY_STATUSES = SurveyStatus;
export const SURVEY_STATUS_VALUES: readonly SurveyStatus[] =
  Object.values(SurveyStatus);

export const REDEMPTION_STATUSES = RedemptionStatus;
export const REDEMPTION_STATUS_VALUES: readonly RedemptionStatus[] =
  Object.values(RedemptionStatus);

export const REFERRAL_STATUSES = ReferralStatus;
export const REFERRAL_STATUS_VALUES: readonly ReferralStatus[] =
  Object.values(ReferralStatus);

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

export function isContractorRelation(v: string): v is ContractorRelation {
  return (CONTRACTOR_RELATION_VALUES as readonly string[]).includes(v);
}

export function isParticipationType(v: string): v is ParticipationType {
  return (PARTICIPATION_TYPE_VALUES as readonly string[]).includes(v);
}

export function isReportCategory(v: string): v is ReportCategory {
  return (REPORT_CATEGORY_VALUES as readonly string[]).includes(v);
}

export function isReportStatus(v: string): v is ReportStatus {
  return (REPORT_STATUS_VALUES as readonly string[]).includes(v);
}

export function isIdeaStatus(v: string): v is IdeaStatus {
  return (IDEA_STATUS_VALUES as readonly string[]).includes(v);
}

export function isAnnouncementKind(v: string): v is AnnouncementKind {
  return (ANNOUNCEMENT_KIND_VALUES as readonly string[]).includes(v);
}

export function isHrDocumentKind(v: string): v is HrDocumentKind {
  return (HR_DOCUMENT_KIND_VALUES as readonly string[]).includes(v);
}

export function isCertificateStatus(v: string): v is CertificateStatus {
  return (CERTIFICATE_STATUS_VALUES as readonly string[]).includes(v);
}

export function isLeaveKind(v: string): v is LeaveKind {
  return (LEAVE_KIND_VALUES as readonly string[]).includes(v);
}

export function isLeaveStatus(v: string): v is LeaveStatus {
  return (LEAVE_STATUS_VALUES as readonly string[]).includes(v);
}

export function isSummonAttendanceStatus(
  v: string,
): v is SummonAttendanceStatus {
  return (SUMMON_ATTENDANCE_STATUS_VALUES as readonly string[]).includes(v);
}

export function isEnrollmentStatus(v: string): v is EnrollmentStatus {
  return (ENROLLMENT_STATUS_VALUES as readonly string[]).includes(v);
}

export function isRequirementKind(v: string): v is RequirementKind {
  return (REQUIREMENT_KIND_VALUES as readonly string[]).includes(v);
}

export function isExamKind(v: string): v is ExamKind {
  return (EXAM_KIND_VALUES as readonly string[]).includes(v);
}

export function isSurveyStatus(v: string): v is SurveyStatus {
  return (SURVEY_STATUS_VALUES as readonly string[]).includes(v);
}

export function isRedemptionStatus(v: string): v is RedemptionStatus {
  return (REDEMPTION_STATUS_VALUES as readonly string[]).includes(v);
}

export function isReferralStatus(v: string): v is ReferralStatus {
  return (REFERRAL_STATUS_VALUES as readonly string[]).includes(v);
}
