import { request } from "./client";

export type EmployeeRow = {
  id: string;
  userId: string;
  registration: string | null;
  taxId: string | null;
  phone: string | null;
  admittedAt: string | null;
  dismissedAt: string | null;
  dismissalReason: string | null;
  user: { id: string; name: string; login: string; email: string | null };
  jobRole: { id: string; name: string } | null;
};

export type RequirementStatus = {
  id: string;
  kind: string;
  name: string;
  validity_months: number | null;
  /** ok | missing | expired | pending | rejected */
  status: string;
  certificate: {
    id: string;
    name: string;
    issued_at: string | null;
    expires_at: string | null;
    has_file: boolean;
  } | null;
};

export type EmployeeFile = {
  profile: EmployeeRow & {
    dismissedBy: { id: string; name: string } | null;
    jobRole:
      | {
          id: string;
          name: string;
          description: string | null;
          sector: { id: string; name: string; establishment: { id: string; name: string } };
        }
      | null;
  };
  membership: {
    role: string;
    access_expires_at: string | null;
    access_active: boolean;
  } | null;
  requirements: RequirementStatus[];
  certificates: {
    id: string;
    name: string;
    status: string;
    issuedAt: string | null;
    expiresAt: string | null;
    has_file: boolean;
  }[];
  exams: { id: string; kind: string; performedAt: string | null; dueAt: string | null }[];
  service_order: {
    id: string;
    version: number;
    issued_at: string;
    acknowledged_at: string | null;
  } | null;
  actions: { id: string; title: string; status: string; dueDate: string | null }[];
  history: { id: string; action: string; at: string; who: string }[];
};

export function fetchEmployees(includeDismissed = false) {
  const qs = includeDismissed ? "?include_dismissed=true" : "";
  return request<{ profiles: EmployeeRow[] }>(`/api/employee-profiles${qs}`).then(
    (d) => d.profiles,
  );
}

export function fetchEmployeeFile(id: string) {
  return request<EmployeeFile>(
    `/api/employee-profiles/${encodeURIComponent(id)}/ficha`,
  );
}

export function dismissEmployee(
  id: string,
  input: { dismissedAt?: string; reason?: string },
) {
  return request<{ profile: EmployeeRow; access_revoked: boolean }>(
    `/api/employee-profiles/${encodeURIComponent(id)}/desligamento`,
    {
      method: "POST",
      body: JSON.stringify({
        dismissed_at: input.dismissedAt,
        reason: input.reason,
      }),
    },
  );
}

export function reinstateEmployee(id: string) {
  return request<{ profile: EmployeeRow }>(
    `/api/employee-profiles/${encodeURIComponent(id)}/reverter-desligamento`,
    { method: "POST" },
  );
}

export const REQUIREMENT_STATUS_LABEL: Record<string, string> = {
  ok: "Em dia",
  missing: "Sem comprovante",
  expired: "Vencido",
  pending: "Em análise",
  rejected: "Recusado",
};
