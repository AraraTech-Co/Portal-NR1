import { request } from "./client";

export type EthicsCategory = { id: string };

/** Com a empresa, o canal público sabe de quem é antes de alguém escrever. [S4-L] */
export function fetchEthicsMeta(organizationId?: string) {
  const qs = organizationId
    ? `?organization_id=${encodeURIComponent(organizationId)}`
    : "";
  return request<{
    categories: EthicsCategory[];
    statuses: EthicsCategory[];
    organization: { id: string; name: string } | null;
  }>(`/api/ethics-reports/meta${qs}`);
}

export function createEthicsReport(input: {
  category: string;
  description: string;
  is_anonymous: boolean;
  establishment_id?: string;
  /** Fora do portal não há sessão: a empresa vem do link. [S4-L] */
  organization_id?: string;
}) {
  return request<{
    report: {
      id: string;
      protocol: string;
      category: string;
      description: string;
      isAnonymous: boolean;
      status: string;
    };
    access_code: string;
    message: string;
  }>("/api/ethics-reports", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function trackEthicsReport(input: {
  protocol: string;
  access_code: string;
}) {
  return request<{
    report: {
      id: string;
      protocol: string;
      category: string;
      description: string;
      isAnonymous: boolean;
      status: string;
      resolutionNote: string | null;
      resolvedAt: string | null;
      messages: Array<{
        id: string;
        side: string;
        body: string;
        createdAt: string;
      }>;
    };
  }>("/api/ethics-reports/track", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Denunciante responde ao comitê, pelo protocolo e código. Nada o identifica. [S5-P] */
export function sendReporterMessage(input: { protocol: string; access_code: string; body: string }) {
  return request<{ message: { id: string; side: string; body: string; createdAt: string } }>(
    "/api/ethics-reports/messages",
    { method: "POST", body: JSON.stringify(input) },
  );
}

export type EthicsMessage = {
  id: string;
  side: "REPORTER" | "COMMITTEE";
  body: string;
  createdAt: string;
  author: { id: string; name: string } | null;
};

export type EthicsReportDetail = {
  id: string;
  protocol: string;
  category: string;
  description: string;
  isAnonymous: boolean;
  status: string;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  establishment: { id: string; name: string } | null;
  messages: EthicsMessage[];
};

/** Comitê abre o relato (e marca como lidas as mensagens do denunciante). [S5-L] */
export function fetchEthicsReport(id: string) {
  return request<{ report: EthicsReportDetail }>(`/api/ethics-reports/${encodeURIComponent(id)}`);
}

export function sendCommitteeMessage(id: string, body: string) {
  return request<{ message: EthicsMessage }>(`/api/ethics-reports/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function updateEthicsStatus(id: string, input: { status: string; resolution_note?: string }) {
  return request(`/api/ethics-reports/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
