import { ActionPriority } from "@prisma/client";

/** `RiskAssessment.resultingLevel` é texto; estes são os valores gravados. */
export type RiskLevel =
  | "INTOLERABLE"
  | "SUBSTANTIAL"
  | "MODERATE"
  | "TOLERABLE"
  | "TRIVIAL";

/**
 * De que prazo uma ação precisa, conforme o nível do risco.
 *
 * O prazo era só uma sugestão da tela: "3 meses para entregar luva" passava
 * sem ninguém notar, e data no passado também. Decisão S2-M: o prazo do nível
 * é limite, e passar dele exige justificativa escrita, que fica registrada.
 * Data no passado é recusada sempre. [S2-M] [CB-21]
 *
 * Espelho de `PRIORITY_BY_LEVEL` e `DAYS_BY_PRIORITY` em
 * `client/src/pages/ControlActionPanel.tsx` — a tela sugere, o servidor cobra.
 */
export const PRIORITY_BY_LEVEL: Record<RiskLevel, ActionPriority> = {
  INTOLERABLE: ActionPriority.CRITICAL,
  SUBSTANTIAL: ActionPriority.HIGH,
  MODERATE: ActionPriority.MEDIUM,
  TOLERABLE: ActionPriority.LOW,
  TRIVIAL: ActionPriority.LOW,
};

export const DAYS_BY_PRIORITY: Record<ActionPriority, number> = {
  CRITICAL: 7,
  HIGH: 30,
  MEDIUM: 90,
  LOW: 180,
};

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  INTOLERABLE: "Intolerável",
  SUBSTANTIAL: "Substancial",
  MODERATE: "Moderado",
  TOLERABLE: "Tolerável",
  TRIVIAL: "Trivial",
};

/**
 * Último dia aceito sem justificativa, a partir de hoje.
 *
 * O limite vem do NÍVEL DO RISCO, não da prioridade escolhida. A prioridade
 * continua editável, como sempre foi: quem conhece a operação pode marcar
 * uma ação como Alta sem que isso corte o prazo pela metade em silêncio.
 */
export function deadlineLimit(
  level: string | null | undefined,
  hoje = new Date(),
): { days: number; limit: Date } {
  const porNivel = level ? (PRIORITY_BY_LEVEL[level as RiskLevel] ?? null) : null;
  const dias = porNivel ? DAYS_BY_PRIORITY[porNivel] : DAYS_BY_PRIORITY.MEDIUM;
  const limite = new Date(
    Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()) +
      dias * 86_400_000,
  );
  return { days: dias, limit: limite };
}

/** Meia-noite UTC do dia de hoje em Brasília, para comparar só a data. */
export function hojeEmBrasilia(agora = new Date()): Date {
  const brasilia = new Date(agora.getTime() - 3 * 3_600_000);
  return new Date(
    Date.UTC(
      brasilia.getUTCFullYear(),
      brasilia.getUTCMonth(),
      brasilia.getUTCDate(),
    ),
  );
}
