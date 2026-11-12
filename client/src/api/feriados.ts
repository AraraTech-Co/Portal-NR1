import { request } from "./client";

/** Feriados do prazo da denúncia. [C4-11] */
export type Feriado = {
  id: string;
  date: string;
  name: string;
  recurring: boolean;
  establishment_id: string | null;
};

export type FilialDosFeriados = {
  id: string;
  name: string;
  good_friday: boolean;
  corpus_christi: boolean;
};

export function fetchFeriados() {
  return request<{ feriados: Feriado[]; filiais: FilialDosFeriados[] }>("/api/feriados");
}

export function criarFeriado(input: { date: string; name: string; recurring: boolean; establishment_id: string | null }) {
  return request<{ feriado: Feriado }>("/api/feriados", { method: "POST", body: JSON.stringify(input) });
}

export function excluirFeriado(id: string) {
  return request<void>(`/api/feriados/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function mudarFeriadosDaFilial(id: string, input: { good_friday?: boolean; corpus_christi?: boolean }) {
  return request<{ filial: FilialDosFeriados }>(`/api/feriados/filiais/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
