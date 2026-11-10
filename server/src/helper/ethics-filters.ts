import { ReportCategory, ReportSeverity, ReportStatus } from "@prisma/client";
import {
  DEADLINE_SITUATIONS,
  fromZoned,
  type DeadlineSituation,
} from "./business-days";

/**
 * Os filtros da lista do comitê — os mesmos da tela, do PDF da lista e da
 * trilha da exportação. Vêm da query string: voltar do detalhe mantém o
 * filtro, e o PDF imprime exatamente o que a lista mostra. [C1-6]
 *
 * Nomes na query: unidade, status (vários, separados por vírgula),
 * gravidade, categoria, de, ate (AAAA-MM-DD), prazo, ciencia (com|sem),
 * protocolo.
 */
export type EthicsFilters = {
  establishmentId?: string;
  statuses?: ReportStatus[];
  severity?: ReportSeverity;
  category?: ReportCategory;
  from?: string;
  to?: string;
  situation?: DeadlineSituation;
  ack?: "com" | "sem";
  protocol?: string;
};

type Invalid = { field: string; message: string };

const DIA = /^\d{4}-\d{2}-\d{2}$/;

function one(v: unknown): string | undefined {
  if (Array.isArray(v)) v = v[0];
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

function realDay(v: string): boolean {
  if (!DIA.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function parseEthicsFilters(
  q: Record<string, unknown>,
): { filters: EthicsFilters } | { error: Invalid } {
  const f: EthicsFilters = {};

  const unidade = one(q.unidade);
  if (unidade) f.establishmentId = unidade;

  const status = one(q.status);
  if (status) {
    const lista = [...new Set(status.split(",").map((s) => s.trim()).filter(Boolean))];
    const validos = Object.values(ReportStatus) as string[];
    const errado = lista.find((s) => !validos.includes(s));
    if (errado) return { error: { field: "status", message: `Situação inválida: ${errado}.` } };
    f.statuses = lista as ReportStatus[];
  }

  const gravidade = one(q.gravidade);
  if (gravidade) {
    if (!(Object.values(ReportSeverity) as string[]).includes(gravidade)) {
      return { error: { field: "gravidade", message: "Gravidade inválida." } };
    }
    f.severity = gravidade as ReportSeverity;
  }

  const categoria = one(q.categoria);
  if (categoria) {
    if (!(Object.values(ReportCategory) as string[]).includes(categoria)) {
      return { error: { field: "categoria", message: "Categoria inválida." } };
    }
    f.category = categoria as ReportCategory;
  }

  for (const [campo, chave] of [
    ["de", "from"],
    ["ate", "to"],
  ] as const) {
    const v = one(q[campo]);
    if (!v) continue;
    if (!realDay(v)) {
      return { error: { field: campo, message: "Data inválida: use AAAA-MM-DD." } };
    }
    f[chave] = v;
  }
  if (f.from && f.to && f.from > f.to) {
    return { error: { field: "ate", message: "O fim do período vem antes do início." } };
  }

  const prazo = one(q.prazo);
  if (prazo) {
    if (!(DEADLINE_SITUATIONS as string[]).includes(prazo)) {
      return { error: { field: "prazo", message: "Situação do prazo inválida." } };
    }
    f.situation = prazo as DeadlineSituation;
  }

  const ciencia = one(q.ciencia);
  if (ciencia) {
    if (ciencia !== "com" && ciencia !== "sem") {
      return { error: { field: "ciencia", message: "Ciência: use com ou sem." } };
    }
    f.ack = ciencia;
  }

  const protocolo = one(q.protocolo);
  if (protocolo) f.protocol = protocolo.toUpperCase().slice(0, 40);

  return { filters: f };
}

function dayStart(day: string): Date {
  const [year, month, d] = day.split("-").map(Number);
  return fromZoned({ year, month, day: d, hour: 0, minute: 0, second: 0, ms: 0 });
}

function dayEnd(day: string): Date {
  const [year, month, d] = day.split("-").map(Number);
  return fromZoned({ year, month, day: d, hour: 23, minute: 59, second: 59, ms: 999 });
}

/**
 * O que o banco filtra. A situação do prazo depende do relógio e é aplicada
 * depois, por quem chama. O período é o do recebimento, em dias de Brasília.
 */
export function ethicsFiltersWhere(f: EthicsFilters): Record<string, unknown>[] {
  const and: Record<string, unknown>[] = [];
  if (f.establishmentId) and.push({ establishmentId: f.establishmentId });
  if (f.statuses?.length) and.push({ status: { in: f.statuses } });
  if (f.severity) and.push({ severity: f.severity });
  if (f.category) and.push({ category: f.category });
  if (f.from) and.push({ createdAt: { gte: dayStart(f.from) } });
  if (f.to) and.push({ createdAt: { lte: dayEnd(f.to) } });
  if (f.ack === "com") and.push({ reporterAckAt: { not: null } });
  if (f.ack === "sem") and.push({ reporterAckAt: null });
  if (f.protocol) and.push({ protocol: { contains: f.protocol, mode: "insensitive" } });
  return and;
}

/** Ordem padrão: atrasadas, depois as que vencem hoje, depois as mais recentes. */
export function situationRank(s: DeadlineSituation): number {
  if (s === "OVERDUE") return 0;
  if (s === "DUE_TODAY") return 1;
  return 2;
}
