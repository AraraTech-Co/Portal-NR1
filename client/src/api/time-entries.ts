import { request } from "./client";

/** Banco de horas: o RH lança, o colaborador consulta. [S5-M] [S5-O] */
export type TimeEntry = {
  id: string;
  userId: string;
  day: string;
  balanceMinutes: number;
  /** Quem lançou. Nulo nos lançamentos anteriores à coluna. [CB-66] */
  createdBy?: { id: string; name: string } | null;
  createdAt?: string;
  note: string | null;
};

export function fetchTimeEntryList(userId?: string) {
  const qs = userId ? `?user_id=${encodeURIComponent(userId)}` : "";
  return request<{ entries: TimeEntry[] }>(`/api/time-entries${qs}`).then(
    (d) => d.entries,
  );
}

export function saveTimeEntry(input: {
  user_id: string;
  day: string;
  balance_minutes: number;
  note?: string;
}) {
  return request<{ entry: TimeEntry }>("/api/time-entries", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
