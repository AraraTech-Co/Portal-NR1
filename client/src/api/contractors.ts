import { request } from "./client";

/** NR-1 1.5.8: quem contrata e quem é contratado se informam dos riscos. */
export const CONTRACTOR_RELATION_LABEL: Record<string, string> = {
  WE_HIRE: "Nós contratamos",
  WE_ARE_HIRED: "Somos contratados",
};

export type ContractorRow = {
  id: string;
  name: string;
  taxId: string | null;
  relation: string;
  servicesScope: string | null;
  interactionMeasures: string | null;
  documentsReceivedAt: string | null;
  risksInformedAt: string | null;
  establishment: { id: string; name: string } | null;
  /** Pessoas do portal ligadas a esta empresa. [S1-R] */
  workers?: number;
};

export function fetchContractorList() {
  return request<{ contractors: ContractorRow[] }>("/api/contractors").then(
    (d) => d.contractors,
  );
}

type ContractorInput = {
  name: string;
  tax_id?: string;
  relation?: string;
  establishment_id?: string;
  services_scope?: string;
  interaction_measures?: string;
};

export function createContractor(input: ContractorInput) {
  return request<{ contractor: ContractorRow }>("/api/contractors", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateContractor(id: string, input: ContractorInput) {
  return request<{ contractor: ContractorRow }>(
    `/api/contractors/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function archiveContractor(id: string) {
  return request(`/api/contractors/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function markDocumentsReceived(id: string, date: string) {
  return request(`/api/contractors/${encodeURIComponent(id)}/documents-received`, {
    method: "POST",
    body: JSON.stringify({ documents_received_at: date }),
  });
}

export function markRisksInformed(id: string, date: string) {
  return request(`/api/contractors/${encodeURIComponent(id)}/risks-informed`, {
    method: "POST",
    body: JSON.stringify({ risks_informed_at: date }),
  });
}
