import { request } from "./client";

export type ServiceOrderSummary = {
  id: string;
  version: number;
  issued_at: string;
  issued_by: { id: string; name: string };
  responsible_name: string;
  acknowledged: number;
  pending: number;
  my_ack_at: string | null;
};

export type JobRoleServiceOrder = {
  id: string;
  name: string;
  sector: string;
  establishment: { id: string; name: string };
  people: number;
  is_mine: boolean;
  current: ServiceOrderSummary | null;
  versions: number;
};

export type ServiceOrderContent = {
  generated_at: string;
  job_role: {
    id: string;
    name: string;
    description: string | null;
    sector: string;
    establishment: string;
    establishment_address: string | null;
  };
  activities: {
    id: string;
    name: string;
    description: string | null;
    hazards: {
      id: string;
      description: string;
      category: string;
      source: string | null;
      consequences: string | null;
      exposure_time: string | null;
      exposure_frequency: string | null;
      exposure_intensity: string | null;
      risks: {
        id: string;
        description: string;
        level: string | null;
        controls: { id: string; type: string; description: string; status: string }[];
      }[];
    }[];
  }[];
  requirements: {
    id: string;
    kind: string;
    name: string;
    description: string | null;
    validity_months: number | null;
    training: { id: string; title: string } | null;
  }[];
};

export type ServiceOrderFull = {
  id: string;
  version: number;
  issuedAt: string;
  duties: string;
  emergencyInstructions: string | null;
  responsibleName: string;
  responsibleRole: string | null;
  responsibleRegistration: string | null;
  content: ServiceOrderContent;
  issuedBy: { id: string; name: string };
  jobRole: {
    id: string;
    name: string;
    sector: { name: string; establishment: { id: string; name: string } };
  };
  organization: { name: string; taxId: string | null };
  my_ack_at: string | null;
  is_current: boolean;
  current_version: number;
  can_acknowledge: boolean;
};

export async function fetchServiceOrders(establishmentId?: string) {
  const qs = establishmentId
    ? `?establishment_id=${encodeURIComponent(establishmentId)}`
    : "";
  return request<{
    my_job_role_id: string | null;
    job_roles: JobRoleServiceOrder[];
  }>(`/api/service-orders${qs}`);
}

export async function fetchServiceOrder(id: string) {
  return request<{ service_order: ServiceOrderFull }>(
    `/api/service-orders/${encodeURIComponent(id)}`,
  );
}

export async function fetchServiceOrderAcks(id: string) {
  return request<{
    service_order: { id: string; version: number };
    people: {
      id: string;
      name: string;
      /** Identifica a pessoa no comprovante impresso. [B2-4-G] */
      registration: string | null;
      acknowledged_at: string | null;
    }[];
    acknowledged: number;
    pending: number;
  }>(`/api/service-orders/${encodeURIComponent(id)}/ciencias`);
}

export async function issueServiceOrder(input: {
  jobRoleId: string;
  duties: string;
  emergencyInstructions?: string;
  responsibleName?: string;
  responsibleRole?: string;
  responsibleRegistration?: string;
}) {
  return request<{ service_order: { id: string; version: number }; notified: number }>(
    "/api/service-orders",
    {
      method: "POST",
      body: JSON.stringify({
        job_role_id: input.jobRoleId,
        duties: input.duties,
        emergency_instructions: input.emergencyInstructions,
        responsible_name: input.responsibleName,
        responsible_role: input.responsibleRole,
        responsible_registration: input.responsibleRegistration,
      }),
    },
  );
}

export async function acknowledgeServiceOrder(id: string) {
  return request<{ acknowledgement: { id: string; acknowledgedAt: string } }>(
    `/api/service-orders/${encodeURIComponent(id)}/ciencia`,
    { method: "POST" },
  );
}
