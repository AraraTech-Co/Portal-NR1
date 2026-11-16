import type { PodeArquivar } from "@/lib/arquivar";
import { ApiError, request } from "./client";

export type Establishment = {
  id: string;
  name: string;
  taxId: string | null;
  /** Razão social da filial: os documentos dela saem em nome dela. [C3-4] */
  legalName?: string | null;
  /** Código da folha, como 0682. [C3-4] */
  payrollCode?: string | null;
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
  /** CBO do cargo, da planilha da folha ou do SST. [PF-2] */
  cbo2002?: string | null;
  cbo94?: string | null;
  /** Lugar na lista do setor, escolhido pela empresa. [S1-I] */
  position?: number;
  /** Para não casar função pelo nome na empresa inteira. [CB-6] */
  sector_name?: string;
  establishment?: { id: string; name: string };
  /** Os cargos da folha juntados a esta função (chave do cargo). [C6-4] */
  aliases?: { id: string; chave: string; grafia: string }[];
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

export async function createJobRole(sectorId: string, name: string, confirmarEquivalente = false) {
  return request<{ job_role: JobRole }>("/api/job-roles", {
    method: "POST",
    body: JSON.stringify({
      sector_id: sectorId,
      name,
      ...(confirmarEquivalente ? { confirmar_equivalente: true } : {}),
    }),
  });
}

/**
 * Cria ou renomeia função perguntando antes quando o servidor acha uma
 * equivalente na filial (409 "funcao_equivalente"). Recusado o aviso, nada
 * muda e a mensagem diz isso. [C6-5]
 */
export async function comAvisoDeEquivalente(
  fazer: (confirmar: boolean) => Promise<unknown>,
  seRecusar: string,
  confirmar: (pergunta: string) => boolean = (pergunta) => window.confirm(pergunta),
): Promise<void> {
  try {
    await fazer(false);
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== "funcao_equivalente") throw err;
    if (!confirmar(err.message)) throw new Error(seRecusar);
    await fazer(true);
  }
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
  input: {
    name?: string;
    tax_id?: string | null;
    address?: string | null;
    legal_name?: string | null;
    payroll_code?: string | null;
  },
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

export async function updateJobRole(
  id: string,
  input: { name?: string; cbo_2002?: string | null; cbo_94?: string | null; confirmar_equivalente?: true },
) {
  return request<{ job_role: JobRole }>(`/api/job-roles/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

/** Remover o apelido do cargo da folha: o cargo volta a "Cargos sem função". [C6-4] */
export async function removeJobRoleAlias(jobRoleId: string, aliasId: string) {
  return request(`/api/job-roles/${jobRoleId}/apelidos/${aliasId}`, { method: "DELETE" });
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
