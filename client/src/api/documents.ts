import { request } from "./client";

export const PGR_TYPE_LABEL: Record<string, string> = {
  INVENTORY: "Inventário de riscos",
  ACTION_PLAN: "Plano de ação",
  CRITERIA: "Critérios do GRO",
};

export const PGR_TYPE_HINT: Record<string, string> = {
  INVENTORY:
    "Retrato dos riscos: processo, atividade, perigo, exposição e classificação.",
  ACTION_PLAN:
    "O que será feito, por quem, até quando e como se afere a eficácia.",
  CRITERIA:
    "Gradações de severidade/probabilidade e critérios de decisão do GRO.",
};

export type PgrDocument = {
  id: string;
  type: string;
  version: number;
  issuedAt: string;
  responsibleName: string;
  responsibleRole: string | null;
  signatureStatement: string;
  establishmentId: string | null;
};

export async function fetchPgrDocuments(type?: string) {
  const qs = type ? `?type=${encodeURIComponent(type)}` : "";
  return request<{
    documents: PgrDocument[];
    required_types: string[];
  }>(`/api/pgr-documents${qs}`);
}

export async function issuePgrDocument(input: {
  type: string;
  establishmentId?: string;
  responsibleName: string;
  responsibleRole?: string;
  responsibleRegistration?: string;
  signatureStatement?: string;
}) {
  return request<{ document: PgrDocument }>("/api/pgr-documents", {
    method: "POST",
    body: JSON.stringify({
      type: input.type,
      establishment_id: input.establishmentId || undefined,
      responsible_name: input.responsibleName,
      responsible_role: input.responsibleRole,
      responsible_registration: input.responsibleRegistration,
      signature_statement: input.signatureStatement,
    }),
  });
}

export type InventoryContent = {
  generated_at: string;
  items: {
    hazard_id: string;
    description: string;
    source: string | null;
    consequences: string | null;
    exposed_group: string | null;
    exposed_workers_count: number | null;
    exposure_time: string | null;
    exposure_frequency: string | null;
    exposure_intensity: string | null;
    monitoring_data: string | null;
    category: string;
    activity: string;
    sector: string;
    establishment: string;
    risks: {
      risk_id: string;
      description: string;
      needs_reassessment: boolean;
      level: string | null;
      severity: number | null;
      probability: number | null;
      controls: { id: string; type: string; description: string; status: string }[];
    }[];
  }[];
};

export type ActionPlanContent = {
  generated_at: string;
  actions: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    due_date: string | null;
    effectiveness_criteria: string | null;
    effectiveness_result: string | null;
    evidence_count: number;
  }[];
};

type ScaleItem = { value: number; label: string; description?: string };

export type CriteriaContent = {
  generated_at: string;
  note?: string;
  methodologies: {
    id: string;
    name: string;
    is_default: boolean;
    version: {
      version: number;
      severity_scale: ScaleItem[];
      probability_scale: ScaleItem[];
      matrix: Record<string, string>;
      levels: { id: string; label: string; order: number }[];
    } | null;
  }[];
};

export type PgrDocumentFull = PgrDocument & {
  responsibleRegistration: string | null;
  content: unknown;
  issuedBy: { id: string; name: string };
  establishment: { id: string; name: string } | null;
  organization: { name: string; taxId: string | null };
};

export async function fetchPgrDocument(id: string) {
  return request<{ document: PgrDocumentFull }>(
    `/api/pgr-documents/${encodeURIComponent(id)}`,
  );
}
