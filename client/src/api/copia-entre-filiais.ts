import { request } from "./client";

/** Cópia entre filiais. [C3-8] */
export const NIVEIS_DA_COPIA = [
  "setores",
  "funcoes",
  "atividades",
  "vinculos",
  "perigos",
  "riscos",
  "medidas",
  "avaliacoes",
  "exigencias",
] as const;
export type NivelDaCopia = (typeof NIVEIS_DA_COPIA)[number];

export const NIVEL_DA_COPIA_LABEL: Record<NivelDaCopia, string> = {
  setores: "Setores",
  funcoes: "Funções",
  atividades: "Atividades",
  vinculos: "Vínculos atividade-função",
  perigos: "Perigos",
  riscos: "Riscos",
  medidas: "Medidas",
  avaliacoes: "Avaliações",
  exigencias: "Exigências da função",
};

/** O nome de cada campo que pode divergir, como a tela de origem chama. */
export const CAMPO_DA_COPIA_LABEL: Record<string, string> = {
  name: "Nome",
  description: "Descrição",
  processDescription: "Processo",
  environmentDescription: "Ambiente",
  position: "Ordem na lista",
  source: "Fonte",
  consequences: "Consequências",
  exposedGroup: "Grupo exposto",
  exposedWorkersCount: "Expostos",
  exposureTime: "Tempo de exposição",
  exposureFrequency: "Frequência",
  exposureIntensity: "Intensidade",
  monitoringData: "Monitoramento",
  category: "Categoria",
  status: "Situação",
  origin: "Origem",
  type: "Tipo",
  kind: "Tipo",
  trainingId: "Treinamento",
  validityMonths: "Validade (meses)",
};

export type ConflitoDaCopia = {
  nivel: NivelDaCopia;
  id: string;
  nome: string;
  campos: { campo: string; destino: unknown; origem: unknown }[];
};

export type PreviaDaCopia = {
  origem: { id: string; name: string };
  destino: { id: string; name: string };
  niveis: Record<NivelDaCopia, { criar: number; atualizar: number; iguais: number }>;
  conflitos: ConflitoDaCopia[];
};

export type ResultadoDaCopia = {
  copia_id: string;
  contagem: Record<NivelDaCopia, { criados: number; atualizados: number }>;
  ignorados: ConflitoDaCopia[];
};

export function previaDaCopia(destino: string, origem: string) {
  return request<PreviaDaCopia>(`/api/establishments/${encodeURIComponent(destino)}/copia/previa`, {
    method: "POST",
    body: JSON.stringify({ origem }),
  });
}

export function copiarEntreFiliais(destino: string, origem: string, aceitar: string[]) {
  return request<ResultadoDaCopia>(`/api/establishments/${encodeURIComponent(destino)}/copia`, {
    method: "POST",
    body: JSON.stringify({ origem, aceitar }),
  });
}
