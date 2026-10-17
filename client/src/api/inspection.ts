import { request } from "./client";

export type InspectionItem = {
  ok: boolean;
  label: string;
  detail?: string | null;
  who?: string | null;
  when?: string | null;
  link?: string | null;
  /** Nível do risco: documentação em dia não é risco sob controle. [B2-1-K] */
  level?: string | null;
  note?: string | null;
};

export type InspectionCheck = {
  id: string;
  title: string;
  requirement: string;
  status: "ok" | "pending" | "empty";
  summary: string;
  items: InspectionItem[];
};

export type InspectionOverview = {
  generated_at: string;
  organization: {
    name: string;
    taxId: string | null;
    responsibleName: string | null;
    responsibleRole: string | null;
    responsibleRegistration: string | null;
    assessmentReviewMonths: number;
    hasSstCertification: boolean;
  };
  establishments: { id: string; name: string; address: string | null; taxId: string | null }[];
  establishment_id: string | null;
  /** O painel traz nome por nome (quem responde pelo PGR e a fiscalização). */
  people_detail: boolean;
  checks: InspectionCheck[];
  totals: { checks: number; pending: number; empty: number; items_pending: number };
};

export type AuditEntry = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  at: string;
  who: string;
};

export function fetchInspection(establishmentId?: string) {
  const qs = establishmentId
    ? `?establishment_id=${encodeURIComponent(establishmentId)}`
    : "";
  return request<InspectionOverview>(`/api/fiscalizacao${qs}`);
}

export function fetchInspectionHistory(limit = 50) {
  return request<{ events: AuditEntry[] }>(
    `/api/fiscalizacao/historico?limit=${limit}`,
  );
}

/** Fatos de auditoria em português — o fiscal não lê `assessment.validate`. */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  "establishment.update": "Estabelecimento alterado",
  "establishment.archive": "Estabelecimento arquivado",
  "sector.update": "Setor alterado",
  "sector.archive": "Setor arquivado",
  "job_role.update": "Função alterada",
  "job_role.archive": "Função arquivada",
  "activity.update": "Atividade alterada",
  "activity.archive": "Atividade arquivada",
  "hazard.create": "Perigo registrado",
  "hazard.update": "Perigo alterado",
  "risk.create": "Risco registrado",
  "risk.update": "Risco alterado",
  "assessment.create": "Avaliação de risco feita",
  "assessment.validate": "Avaliação validada",
  "control.create": "Medida de controle registrada",
  "action.create": "Ação aberta",
  "change_event.create": "Mudança registrada",
  "pgr_document.issue": "Documento do PGR emitido",
  "service_order.issue": "Ordem de serviço emitida",
  "service_order.acknowledge": "Ciência da ordem de serviço",
  "aep.create": "Avaliação ergonômica aberta",
  "aep.update": "Avaliação ergonômica alterada",
  "aep.conclude": "Avaliação ergonômica concluída",
  "preliminary_survey.create": "Levantamento preliminar aberto",
  "preliminary_survey.add_item": "Item do levantamento preliminar",
  "occurrence.create": "Ocorrência registrada",
  "occurrence.update": "Ocorrência alterada",
  "occurrence.analyze": "Ocorrência analisada",
  "occurrence.add_action": "Ação aberta a partir da ocorrência",
  "emergency_procedure.create": "Procedimento de emergência criado",
  "emergency_procedure.update": "Procedimento de emergência alterado",
  "emergency_procedure.archive": "Procedimento de emergência arquivado",
  "emergency_drill.create": "Exercício simulado registrado",
  "participation.create": "Participação registrada",
  "participation.update": "Participação alterada",
  "contractor.create": "Terceiro cadastrado",
  "contractor.update": "Terceiro alterado",
  "contractor.archive": "Terceiro arquivado",
  "contractor.documents_received": "Documentos do terceiro recebidos",
  "contractor.risks_informed": "Riscos informados ao terceiro",
  "training.create": "Treinamento criado",
  "training.archive": "Treinamento arquivado",
  "summon.create": "Convocação criada",
  "occupational_exam.create": "Exame ocupacional registrado",
  "employee_profile.create": "Ficha de colaborador criada",
  "employee_profile.update": "Ficha de colaborador alterada",
  "employee_profile.dismiss": "Desligamento registrado",
  "employee_profile.reinstate": "Desligamento revertido",
  "establishment.create": "Estabelecimento cadastrado",
  "sector.create": "Setor cadastrado",
  "job_role.create": "Função cadastrada",
  "activity.create": "Atividade cadastrada",
  "organization.update": "Dados da empresa alterados",
  "session.signin": "Entrou no portal",
  "training_session.create": "Turma presencial registrada",
  "people.import": "Pessoas cadastradas por planilha",
  "hr_document.create": "Documento de RH publicado",
  "announcement.create": "Aviso publicado",
  "idea.create": "Ideia registrada",
  "idea.decide": "Ideia decidida",
  "climate_survey.create": "Pesquisa de clima criada",
  "ethics_report.create": "Denúncia recebida",
  "ethics_report.update_status": "Denúncia teve a situação alterada",
  "medical_certificate.review": "Atestado analisado",
  "leave.decide": "Pedido de férias ou licença decidido",
  "payslip.create": "Holerite publicado",
  "payslip.replace": "Holerite substituído",
  "membership.role_changed": "Papel de uma pessoa alterado",
  "user.password_reset": "Senha redefinida",
  "consulta.view": "Consulta abriu uma tela",
};
