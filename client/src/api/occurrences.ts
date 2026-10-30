import { request } from "./client";

export type OccurrenceRow = {
  id: string;
  type: string;
  occurredAt: string;
  description: string;
  generatingSituation: string | null;
  organizationalData: string | null;
  preventionReview: string | null;
  analyzedAt: string | null;
  establishment: { id: string; name: string } | null;
  risk: { id: string; description: string } | null;
  reportedBy: { id: string; name: string };
  analyzedBy: { id: string; name: string } | null;
  _count: { actions: number; evidences: number };
};

export type OccurrenceDetail = OccurrenceRow & {
  /**
   * As ações do risco ligado, de antes e de depois da ocorrência — não só o
   * que nasceu dela, que deixava a lista sempre vazia. [B3-4-C]
   */
  actions: {
    id: string;
    title: string;
    status: string;
    priority: string;
    dueDate: string | null;
    completedAt: string | null;
    validatedAt: string | null;
    assignee: { id: string; name: string } | null;
    validatedBy: { id: string; name: string } | null;
    from_occurrence: boolean;
  }[];
  evidences: {
    id: string;
    fileName: string | null;
    uploadedAt: string;
  }[];
};

export async function fetchOccurrences(params?: {
  establishmentId?: string;
  type?: string;
}) {
  const qs = new URLSearchParams();
  if (params?.establishmentId) {
    qs.set("establishment_id", params.establishmentId);
  }
  if (params?.type) qs.set("type", params.type);
  const suffix = qs.toString() ? `?${qs}` : "";
  return request<{ occurrences: OccurrenceRow[] }>(
    `/api/occurrences${suffix}`,
  );
}

export async function fetchOccurrence(id: string) {
  return request<{ occurrence: OccurrenceDetail }>(`/api/occurrences/${id}`);
}

export async function createOccurrence(input: {
  type: string;
  description: string;
  occurredAt: string;
  establishmentId?: string;
  riskId?: string;
}) {
  return request<{ occurrence: { id: string } }>("/api/occurrences", {
    method: "POST",
    body: JSON.stringify({
      type: input.type,
      description: input.description,
      occurred_at: input.occurredAt,
      establishment_id: input.establishmentId || undefined,
      risk_id: input.riskId || undefined,
    }),
  });
}

export async function analyzeOccurrence(
  id: string,
  input: {
    generatingSituation: string;
    organizationalData: string;
    preventionReview: string;
  },
) {
  return request<{ occurrence: OccurrenceDetail }>(
    `/api/occurrences/${id}/analyze`,
    {
      method: "POST",
      body: JSON.stringify({
        generating_situation: input.generatingSituation,
        organizational_data: input.organizationalData,
        prevention_review: input.preventionReview,
      }),
    },
  );
}

/** Abrir ação a partir da ocorrência. O caminho existia só no servidor. [B3-4-C] */
export async function addOccurrenceAction(
  id: string,
  input: {
    title: string;
    description?: string;
    assignee_id: string;
    due_date: string;
    priority?: string;
    /** Prazo além do que o nível do risco pede: por quê. [CB-72] */
    deadline_justification?: string;
    /** Obrigatório: a ação não abre sem ele. [B3-4-A] */
    effectiveness_criteria: string;
  },
) {
  return request<{ action: { id: string; title: string } }>(
    `/api/occurrences/${id}/actions`,
    { method: "POST", body: JSON.stringify(input) },
  );
}
