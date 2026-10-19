import { request } from "./client";

/** Férias e licenças: pedir, acompanhar e decidir. [S5-D] */
export type Leave = {
  id: string;
  userId: string;
  kind: string;
  status: string;
  startDate: string;
  endDate: string;
  days: number;
  note: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  user: { id: string; name: string };
  decidedBy: { id: string; name: string } | null;
  /** 12 meses de casa fecham o período aquisitivo (CLT art. 130). */
  vacation_right: {
    admitted_at: string | null;
    complete_at: string | null;
    entitled: boolean;
  } | null;
};

export function fetchLeaveRequests() {
  return request<{ leaves: Leave[] }>("/api/leaves").then((d) => d.leaves);
}

export function requestLeave(input: {
  kind: string;
  start_date: string;
  end_date: string;
  note?: string;
}) {
  return request<{ leave: Leave }>("/api/leaves", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function decideLeave(
  id: string,
  input: { status: "APPROVED" | "REJECTED"; decision_note?: string },
) {
  return request<{ leave: Leave }>(`/api/leaves/${id}/decide`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function cancelLeave(id: string) {
  return request<{ leave: Leave }>(`/api/leaves/${id}/cancel`, {
    method: "POST",
  });
}
