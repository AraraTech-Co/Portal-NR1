import type { PodeArquivar } from "@/lib/arquivar";
import { request } from "./client";

export type Establishment = {
  id: string;
  name: string;
  taxId: string | null;
  address: string | null;
  archivedAt: string | null;
};

export type Sector = {
  id: string;
  establishmentId: string;
  name: string;
  description: string | null;
};

export type JobRole = {
  id: string;
  sectorId: string;
  name: string;
  description: string | null;
  /** Lugar na lista do setor, escolhido pela empresa. [S1-I] */
  position?: number;
  /** Para não casar função pelo nome na empresa inteira. [CB-6] */
  sector_name?: string;
  establishment?: { id: string; name: string };
};

export type Activity = {
  id: string;
  establishmentId: string;
  sectorId: string;
  name: string;
  description: string | null;
  job_role_ids: string[];
  /** Quantas pessoas estão nas funções desta atividade. [CB-22] */
  people_count: number;
};

export async function fetchEstablishments() {
  return request<{ establishments: Establishment[] }>("/api/establishments");
}

export async function createEstablishment(name: string) {
  return request<{ establishment: Establishment }>("/api/establishments", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function fetchSectors(establishmentId?: string) {
  const qs = establishmentId
    ? `?establishment_id=${encodeURIComponent(establishmentId)}`
    : "";
  return request<{ sectors: Sector[] }>(`/api/sectors${qs}`);
}

export async function createSector(establishmentId: string, name: string) {
  return request<{ sector: Sector }>("/api/sectors", {
    method: "POST",
    body: JSON.stringify({ establishment_id: establishmentId, name }),
  });
}

export async function fetchJobRoles(sectorId?: string) {
  const qs = sectorId ? `?sector_id=${encodeURIComponent(sectorId)}` : "";
  return request<{ job_roles: JobRole[] }>(`/api/job-roles${qs}`);
}

/** Trocar a função de lugar na lista do setor. [S1-I] */
export async function moveJobRole(id: string, para: "cima" | "baixo") {
  return request<{ job_role_ids: string[] }>(`/api/job-roles/${id}/ordem`, {
    method: "PATCH",
    body: JSON.stringify({ para }),
  });
}

export async function createJobRole(sectorId: string, name: string) {
  return request<{ job_role: JobRole }>("/api/job-roles", {
    method: "POST",
    body: JSON.stringify({ sector_id: sectorId, name }),
  });
}

export async function fetchActivities(sectorId?: string) {
  const qs = sectorId ? `?sector_id=${encodeURIComponent(sectorId)}` : "";
  return request<{ activities: Activity[] }>(`/api/activities${qs}`);
}

export async function createActivity(input: {
  establishmentId: string;
  sectorId: string;
  name: string;
  description?: string;
  jobRoleIds?: string[];
}) {
  return request<{ activity: Activity }>("/api/activities", {
    method: "POST",
    body: JSON.stringify({
      establishment_id: input.establishmentId,
      sector_id: input.sectorId,
      name: input.name,
      description: input.description,
      job_role_ids: input.jobRoleIds,
    }),
  });
}

export async function updateEstablishment(
  id: string,
  input: { name?: string; tax_id?: string | null; address?: string | null },
) {
  return request<{ establishment: Establishment }>(`/api/establishments/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

/** Se dá para arquivar, e o que impede. [B3-1-C] */
export async function fetchCanArchive(
  caminho: "establishments" | "sectors" | "job-roles" | "activities",
  id: string,
) {
  return request<PodeArquivar>(`/api/${caminho}/${id}/pode-arquivar`);
}

export async function archiveEstablishment(id: string) {
  return request(`/api/establishments/${id}`, { method: "DELETE" });
}

export async function updateSector(id: string, input: { name?: string }) {
  return request<{ sector: Sector }>(`/api/sectors/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function archiveSector(id: string) {
  return request(`/api/sectors/${id}`, { method: "DELETE" });
}

export async function updateJobRole(id: string, input: { name?: string }) {
  return request<{ job_role: JobRole }>(`/api/job-roles/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function archiveJobRole(id: string) {
  return request(`/api/job-roles/${id}`, { method: "DELETE" });
}

export async function updateActivity(
  id: string,
  input: { name?: string; description?: string; job_role_ids?: string[] },
) {
  return request<{ activity: Activity }>(`/api/activities/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function archiveActivity(id: string) {
  return request(`/api/activities/${id}`, { method: "DELETE" });
}
