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
