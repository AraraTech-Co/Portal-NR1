/**
 * Metodologia 5×5 padrão que o seed cria: a do portal antigo, com a severidade
 * Catastrófica nunca abaixo de Moderado.
 */
export function defaultMethodologyVersion() {
  const severityScale = [
    { value: 1, label: "Insignificante", description: "Sem afastamento; primeiros socorros" },
    { value: 2, label: "Leve", description: "Afastamento curto, sem sequelas" },
    { value: 3, label: "Moderada", description: "Afastamento prolongado" },
    { value: 4, label: "Grave", description: "Sequela permanente" },
    { value: 5, label: "Catastrófica", description: "Fatalidade ou múltiplas vítimas" },
  ];
  const probabilityScale = [
    { value: 1, label: "Muito improvável", description: "Não se espera que ocorra" },
    { value: 2, label: "Improvável", description: "Pode ocorrer em anos" },
    { value: 3, label: "Possível", description: "Pode ocorrer no ano" },
    { value: 4, label: "Provável", description: "Ocorre algumas vezes por ano" },
    { value: 5, label: "Quase certo", description: "Ocorre com frequência" },
  ];
  const levels = [
    { id: "TRIVIAL", label: "Trivial", order: 1, tone: "slate" },
    { id: "TOLERABLE", label: "Tolerável", order: 2, tone: "emerald" },
    { id: "MODERATE", label: "Moderado", order: 3, tone: "amber" },
    { id: "SUBSTANTIAL", label: "Substancial", order: 4, tone: "orange" },
    { id: "INTOLERABLE", label: "Intolerável", order: 5, tone: "red" },
  ];

  const matrix: Record<string, string> = {};
  for (const s of severityScale) {
    for (const p of probabilityScale) {
      const score = s.value * p.value;
      const level =
        score <= 2
          ? "TRIVIAL"
          : score <= 5
            ? "TOLERABLE"
            : score <= 10
              ? "MODERATE"
              : score <= 15
                ? "SUBSTANTIAL"
                : "INTOLERABLE";
      // Severidade Catastrófica nunca fica abaixo de Moderado (decisão P2).
      matrix[`${s.value}-${p.value}`] =
        s.value === 5 && (level === "TRIVIAL" || level === "TOLERABLE") ? "MODERATE" : level;
    }
  }

  return { severityScale, probabilityScale, matrix, levels };
}
