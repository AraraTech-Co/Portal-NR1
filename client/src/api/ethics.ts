import { request } from "./client";

export type EthicsCategory = { id: string };

export function fetchEthicsMeta() {
  return request<{
    categories: EthicsCategory[];
    statuses: EthicsCategory[];
  }>("/api/ethics-reports/meta");
}

export function createEthicsReport(input: {
  category: string;
  description: string;
  is_anonymous: boolean;
  establishment_id?: string;
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
