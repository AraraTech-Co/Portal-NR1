import { request } from "./client";

/** Unidade sob responsabilidade de um gerente, supervisor ou ADM loja. [C2-13] */
export type ManagedUnit = { id: string; name: string; archived: boolean };

export async function fetchManagedUnits(userId: string) {
  return request<{ role: string; receives_units: boolean; units: ManagedUnit[] }>(
    `/api/pessoas-acessos/${userId}/unidades`,
  );
}

export async function saveManagedUnits(userId: string, establishmentIds: string[]) {
  return request<{ units: ManagedUnit[] }>(`/api/pessoas-acessos/${userId}/unidades`, {
    method: "PUT",
    body: JSON.stringify({ establishment_ids: establishmentIds }),
  });
}
