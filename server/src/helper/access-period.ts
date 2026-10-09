/**
 * Prazo do acesso à organização. Hoje é o do fiscal: ele entra para uma
 * fiscalização e o acesso cai sozinho no fim dela. [S7-A]
 */

/** Sem data informada, o fiscal entra por 30 dias. */
export const DEFAULT_ACCESS_DAYS = 30;
/** Mais que um ano não é fiscalização, é acesso permanente. */
export const MAX_ACCESS_DAYS = 365;

/** Fim do dia em Brasília (UTC-3, sem horário de verão desde 2019). */
export function endOfDayBrasilia(isoDate: string): Date {
  return new Date(`${isoDate}T23:59:59.999-03:00`);
}

function todayBrasilia(now: Date): string {
  return new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Data-limite do acesso a partir do que veio do formulário (`AAAA-MM-DD`).
 * Vazio → hoje + 30 dias. Recusa passado e mais de um ano à frente.
 */
export function resolveAccessUntil(raw: unknown, now = new Date()): Date {
  const today = todayBrasilia(now);
  if (raw === undefined || raw === null || raw === "") {
    return endOfDayBrasilia(addDays(today, DEFAULT_ACCESS_DAYS));
  }
  const value = String(raw).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw Object.assign(new Error("Data do fim do acesso inválida. Use AAAA-MM-DD."), {
      status: 400,
    });
  }
  if (value < today) {
    throw Object.assign(new Error("O fim do acesso não pode ser uma data que já passou."), {
      status: 400,
    });
  }
  if (value > addDays(today, MAX_ACCESS_DAYS)) {
    throw Object.assign(new Error("O acesso do fiscal vai no máximo até um ano a partir de hoje."), {
      status: 400,
    });
  }
  return endOfDayBrasilia(value);
}

export function accessEnded(expiresAt: Date | null | undefined, now = new Date()): boolean {
  return Boolean(expiresAt && expiresAt.getTime() <= now.getTime());
}
