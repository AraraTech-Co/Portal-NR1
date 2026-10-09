import { request } from "./client";

export type RiskOption = {
  id: string;
  description: string;
};

export async function fetchRisks() {
  return request<{ risks: RiskOption[] }>("/api/risks");
}

export type Hazard = {
  id: string;
  activityId: string;
  description: string;
  source: string | null;
  consequences: string | null;
  exposedGroup: string | null;
  exposedWorkersCount: number | null;
  exposureTime: string | null;
  exposureFrequency: string | null;
  exposureIntensity: string | null;
  monitoringData: string | null;
  category: string;
  origin: string;
  status: string;
};

export type HazardInput = {
  activity_id?: string;
  description?: string;
  category?: string;
  origin?: string;
  source?: string | null;
  consequences?: string | null;
  exposed_group?: string | null;
  exposed_workers_count?: number | null;
  exposure_time?: string | null;
  exposure_frequency?: string | null;
  exposure_intensity?: string | null;
  monitoring_data?: string | null;
};

export async function fetchHazards(activityId?: string) {
  const qs = activityId ? `?activity_id=${encodeURIComponent(activityId)}` : "";
  return request<{ hazards: Hazard[] }>(`/api/hazards${qs}`);
}

export async function createHazard(input: HazardInput) {
  return request<{ hazard: Hazard }>("/api/hazards", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateHazard(id: string, input: HazardInput) {
  return request<{ hazard: Hazard }>(`/api/hazards/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function archiveHazard(id: string) {
  return request(`/api/hazards/${id}`, { method: "DELETE" });
}

export type RiskRow = {
  id: string;
  hazardId: string;
  description: string;
  needsReassessment: boolean;
  assessments: Array<{ id: string; resultingLevel: string; validatedAt: string | null }>;
};

export async function fetchRisksByHazard(hazardId: string) {
  return request<{ risks: RiskRow[] }>(`/api/risks?hazard_id=${encodeURIComponent(hazardId)}`);
}

export async function createRisk(hazardId: string, description: string) {
  return request<{ risk: RiskRow }>("/api/risks", {
    method: "POST",
    body: JSON.stringify({ hazard_id: hazardId, description }),
  });
}

export async function updateRisk(id: string, description: string) {
  return request<{ risk: RiskRow }>(`/api/risks/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ description }),
  });
}

export async function archiveRisk(id: string) {
  return request(`/api/risks/${id}`, { method: "DELETE" });
}
