import { request } from "./client";

/** Situação de cada pessoa no painel de ativação. [C1-7] */
export type ActivationSituation =
  | "BLOCKED"
  | "ACTIVE"
  | "LEGACY_UNCLASSIFIED"
  | "MISSING_DATA"
  | "WINDOW_EXPIRED"
  | "AWAITING";

export const ACTIVATION_SITUATION_LABEL: Record<ActivationSituation, string> = {
  ACTIVE: "Ativo",
  AWAITING: "Aguardando primeiro acesso",
  MISSING_DATA: "Sem dados para o primeiro acesso",
  BLOCKED: "Bloqueado",
  WINDOW_EXPIRED: "Prazo vencido",
  LEGACY_UNCLASSIFIED: "Legado não classificado",
};

export type ActivationPerson = {
  userId: string;
  name: string;
  login: string;
  role: string;
  suspended: boolean;
  establishment: { id: string; name: string } | null;
  situation: ActivationSituation;
  activatedAt: string | null;
  firstAccessEligible: boolean;
  firstAccessUntil: string | null;
  lockedUntil: string | null;
  missing: string[];
  lastSigninAt: string | null;
  failures24h: number;
};

export function fetchActivationPanel() {
  return request<{
    people: ActivationPerson[];
    totals_by_unit: Array<{ id: string; name: string; counts: Partial<Record<ActivationSituation, number>> }>;
    can_act: boolean;
  }>("/api/pessoas-acessos/ativacao");
}

/** Reabrir o primeiro acesso de conta nunca ativada e já elegível. */
export function reopenFirstAccess(userId: string) {
  return request<{ ok: true }>(
    `/api/pessoas-acessos/${encodeURIComponent(userId)}/reabrir-primeiro-acesso`,
    { method: "POST" },
  );
}

/** Classificar conta antiga, com justificativa. */
export function classifyLegacyAccount(
  userId: string,
  outcome: "NEVER_SIGNED_IN" | "IN_USE",
  reason: string,
) {
  return request<{ ok: true }>(`/api/pessoas-acessos/${encodeURIComponent(userId)}/classificar`, {
    method: "POST",
    body: JSON.stringify({ outcome, reason }),
  });
}
