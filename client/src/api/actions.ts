import { request } from "./client";
import { getToken } from "./token";

export type ActionRow = {
  id: string;
  title: string;
  description: string | null;
  sourceType: string;
  riskId: string | null;
  occurrenceId: string | null;
  priority: string;
  status: string;
  assigneeId: string | null;
  dueDate: string | null;
  effectivenessCriteria: string | null;
  createdById: string;
  completedAt: string | null;
  effectivenessResult?: string | null;
  rejectionReason?: string | null;
  validatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function fetchActions(riskId?: string) {
  const qs = riskId ? `?risk_id=${encodeURIComponent(riskId)}` : "";
  return request<{ actions: ActionRow[] }>(`/api/actions${qs}`);
}

export type EvidenceRow = {
  id: string;
  type: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  description: string | null;
  eventDate: string | null;
  uploadedAt: string;
  validationStatus: "PENDING" | "ACCEPTED" | "REJECTED";
  reviewedAt: string | null;
  actionId: string | null;
  uploadedBy: { id: string; name: string };
  reviewedBy: { id: string; name: string } | null;
};

export function fetchActionEvidences(actionId: string) {
  return request<{ evidences: EvidenceRow[] }>(
    `/api/evidences?action_id=${encodeURIComponent(actionId)}`,
  );
}

/** Arquivo da evidência (o endpoint exige o token, então não dá para usar a URL direto num <img>). */
export async function fetchEvidenceBlob(id: string): Promise<Blob> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`/api/evidences/${id}/file`, { headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { message?: string }).message || `Erro ${res.status}`);
  }
  return res.blob();
}

export type ActionReview =
  | { decision: "approve"; effectiveness_result?: string }
  | { decision: "reject"; rejection_reason: string };

export function reviewAction(id: string, body: ActionReview) {
  return request<{ action: ActionRow }>(`/api/actions/${id}/review`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
