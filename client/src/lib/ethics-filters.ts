import type { EthicsFilters } from "@/api/ethics";
import {
  DEADLINE_SITUATION_LABEL,
  REPORT_CATEGORY_LABEL,
  REPORT_SEVERITY_LABEL,
  REPORT_STATUS_LABEL,
} from "@/lib/labels";

/**
 * Os nomes dos filtros na query string da lista do comitê. Voltar do
 * detalhe mantém o filtro, e o PDF usa exatamente o mesmo. [C1-6]
 */
export const ETHICS_FILTER_KEYS = [
  "unidade",
  "status",
  "gravidade",
  "categoria",
  "de",
  "ate",
  "prazo",
  "ciencia",
  "protocolo",
] as const;

/** Só os filtros, sem a página: é o que vai para o PDF. */
export function filtersQuery(params: URLSearchParams): string {
  const q = new URLSearchParams();
  for (const k of ETHICS_FILTER_KEYS) {
    const v = params.get(k);
    if (v) q.set(k, v);
  }
  return q.toString();
}

function dia(v: string): string {
  const [y, m, d] = v.split("-");
  return `${d}/${m}/${y}`;
}

/** Os filtros em texto, para a tela e para o cabeçalho do PDF. [C1-6] */
export function describeEthicsFilters(
  f: EthicsFilters,
  establishmentName: string | null,
): string[] {
  const out: string[] = [];
  if (f.establishmentId) out.push(`Unidade: ${establishmentName ?? "—"}`);
  if (f.statuses?.length) {
    out.push(`Situação: ${f.statuses.map((s) => REPORT_STATUS_LABEL[s] ?? s).join(", ")}`);
  }
  if (f.severity) out.push(`Gravidade: ${REPORT_SEVERITY_LABEL[f.severity] ?? f.severity}`);
  if (f.category) out.push(`Categoria: ${REPORT_CATEGORY_LABEL[f.category] ?? f.category}`);
  if (f.from && f.to) out.push(`Recebidas de ${dia(f.from)} a ${dia(f.to)}`);
  else if (f.from) out.push(`Recebidas a partir de ${dia(f.from)}`);
  else if (f.to) out.push(`Recebidas até ${dia(f.to)}`);
  if (f.situation) {
    out.push(`Prazo: ${DEADLINE_SITUATION_LABEL[f.situation] ?? f.situation}`);
  }
  if (f.ack) out.push(f.ack === "com" ? "Com ciência do denunciante" : "Sem ciência do denunciante");
  if (f.protocol) out.push(`Protocolo contém: ${f.protocol}`);
  return out;
}
