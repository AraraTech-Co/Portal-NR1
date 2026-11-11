import { request } from "./client";

/** Histórico sem unidade: a central classifica, a partir da ficha. [C3-7] */
export const TIPOS_DO_HISTORICO = [
  "holerite",
  "ferias",
  "ponto",
  "atestado",
  "documento_rh",
  "exame",
  "certificado",
] as const;
export type TipoDoHistorico = (typeof TIPOS_DO_HISTORICO)[number];

export const TIPO_DO_HISTORICO_LABEL: Record<TipoDoHistorico, string> = {
  holerite: "Holerites",
  ferias: "Férias e licenças",
  ponto: "Banco de horas",
  atestado: "Atestados",
  documento_rh: "Documentos pessoais do RH",
  exame: "Exames",
  certificado: "Certificados",
};

export type ItemSemUnidade = {
  id: string;
  pessoa: { id: string; nome: string };
  descricao: string;
  data: string;
  proposta: { id: string; name: string } | null;
};

export type HistoricoSemUnidade = {
  tipo: TipoDoHistorico;
  totais: Record<TipoDoHistorico, number>;
  itens: ItemSemUnidade[];
  unidades: { id: string; name: string }[];
  por_pagina: number;
  offset: number;
};

export function fetchHistoricoSemUnidade(tipo: TipoDoHistorico, offset = 0) {
  return request<HistoricoSemUnidade>(
    `/api/historico-sem-unidade?tipo=${encodeURIComponent(tipo)}&offset=${offset}`,
  );
}

export function classificarHistorico(
  tipo: TipoDoHistorico,
  itens: { id: string; establishment_id: string }[],
) {
  return request<{ classificados: number; ignorados: string[] }>(
    "/api/historico-sem-unidade/classificar",
    { method: "POST", body: JSON.stringify({ tipo, itens }) },
  );
}
