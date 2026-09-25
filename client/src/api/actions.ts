import { request } from "./client";

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
  createdAt: string;
  updatedAt: string;
};

export async function fetchActions(riskId?: string) {
  const qs = riskId ? `?risk_id=${encodeURIComponent(riskId)}` : "";
  return request<{ actions: ActionRow[] }>(`/api/actions${qs}`);
}
