import { request } from "./client";

export type RiskOption = {
  id: string;
  description: string;
};

export async function fetchRisks() {
  return request<{ risks: RiskOption[] }>("/api/risks");
}
