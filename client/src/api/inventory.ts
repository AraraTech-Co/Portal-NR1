import { request } from "./client";

export type InventoryControl = {
  id: string;
  type: string;
  description: string;
  status: string;
};

export type InventoryRisk = {
  risk_id: string;
  description: string;
  needs_reassessment: boolean;
  level: string | null;
  severity: number | null;
  probability: number | null;
  controls: InventoryControl[];
};

export type InventoryItem = {
  hazard_id: string;
  description: string;
  source: string | null;
  consequences: string | null;
  exposed_group: string | null;
  category: string | null;
  activity: string;
  sector: string;
  establishment: string;
  risks: InventoryRisk[];
};

export type InventorySnapshot = {
  generated_at: string;
  items: InventoryItem[];
};

export async function fetchInventory(establishmentId?: string) {
  const qs = establishmentId
    ? `?establishment_id=${encodeURIComponent(establishmentId)}`
    : "";
  return request<{ inventory: InventorySnapshot }>(`/api/inventory${qs}`);
}
