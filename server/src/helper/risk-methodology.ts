/**
 * Resolve severidade × probabilidade no nível da matriz da versão.
 * Nunca estima — combinação ausente = erro (BR-4).
 */
export function resolveLevel(
  version: {
    severityScale: unknown;
    probabilityScale: unknown;
    matrix: unknown;
  },
  severity: number,
  probability: number,
): string {
  const severityScale = version.severityScale as Array<{ value: number }>;
  const probabilityScale = version.probabilityScale as Array<{ value: number }>;
  const matrix = version.matrix as Record<string, string>;

  const inSeverity = severityScale.some((s) => s.value === severity);
  const inProbability = probabilityScale.some((p) => p.value === probability);
  if (!inSeverity || !inProbability) {
    throw Object.assign(
      new Error("Severidade ou probabilidade fora da escala da metodologia"),
      { status: 400 },
    );
  }
  const level = matrix[`${severity}-${probability}`];
  if (!level) {
    throw Object.assign(
      new Error(`Matriz da metodologia não define ${severity}-${probability}`),
      { status: 400 },
    );
  }
  return level;
}
