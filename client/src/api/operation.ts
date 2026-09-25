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
};

export type Activity = {
  id: string;
  establishmentId: string;
  sectorId: string;
  name: string;
  description: string | null;
  job_role_ids: string[];
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
