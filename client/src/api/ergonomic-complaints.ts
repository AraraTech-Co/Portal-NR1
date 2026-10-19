import { request } from "./client";

export type ErgonomicComplaint = {
  id: string;
  bodyPart: string | null;
  description: string;
  jobRoleName: string | null;
  status: "OPEN" | "IN_EVALUATION" | "CLOSED";
  aepId: string | null;
  handledAt: string | null;
  handlingNote: string | null;
  createdAt: string;
  user: { id: string; name: string };
  establishment: { id: string; name: string } | null;
  handledBy: { id: string; name: string } | null;
};

/** A queixa é de quem trabalha; quem cuida do módulo vê as de todos. [P1] */
export function fetchErgonomicComplaints() {
  return request<{ complaints: ErgonomicComplaint[]; manages: boolean }>(
    "/api/queixas-ergonomicas",
  );
}

export function createErgonomicComplaint(input: {
  description: string;
  body_part?: string;
}) {
  return request<{ complaint: ErgonomicComplaint }>("/api/queixas-ergonomicas", {
    method: "POST",
    body: JSON.stringify(input),
  }).then((d) => d.complaint);
}

/** O SST transforma a queixa em avaliação ergonômica. [P1] */
export function evaluateErgonomicComplaint(
  id: string,
  input: {
    establishment_id: string;
    scope_description: string;
    sector_id?: string;
    note?: string;
  },
) {
  return request<{ aep_id: string }>(
    `/api/queixas-ergonomicas/${encodeURIComponent(id)}/avaliacao`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function closeErgonomicComplaint(id: string, note: string) {
  return request<{ ok: true }>(
    `/api/queixas-ergonomicas/${encodeURIComponent(id)}/encerramento`,
    { method: "POST", body: JSON.stringify({ note }) },
  );
}
