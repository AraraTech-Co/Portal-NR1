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

export type RiskHistory = {
  risk: {
    id: string;
    description: string;
    needsReassessment: boolean;
    reassessmentReason: string | null;
    createdAt: string;
    hazard: {
      id: string;
      description: string;
      category: string;
      activity: string;
      sector: string;
      establishment: string;
    };
  };
  assessments: Array<{
    id: string;
    severity: number;
    probability: number;
    level: string;
    status: string;
    severityReason: string | null;
    probabilityReason: string | null;
    controlsConsidered: string | null;
    assessedAt: string;
    expiresAt: string | null;
    validatedAt: string | null;
    supersededAt: string | null;
    assessor: { id: string; name: string };
    validatedBy: { id: string; name: string } | null;
    methodology: string;
  }>;
  controls: Array<{
    id: string;
    type: string;
    description: string;
    status: string;
    implementedAt: string | null;
  }>;
  actions: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    dueDate: string | null;
    completedAt: string | null;
    validatedAt: string | null;
    assignee: { id: string; name: string } | null;
  }>;
  changes: Array<{
    id: string;
    action: string;
    entityType: string;
    before: unknown;
    after: unknown;
    createdAt: string;
    actor: { id: string; name: string } | null;
  }>;
};

/** Histórico de um risco: avaliações, controles, ações e quem mudou o quê. [S2-N] */
export async function fetchRiskHistory(riskId: string) {
  return request<RiskHistory>(`/api/risks/${encodeURIComponent(riskId)}/historico`);
}
