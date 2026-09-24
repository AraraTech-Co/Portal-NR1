export const REQUIRED_PGR_DOCUMENTS = [
  "INVENTORY",
  "ACTION_PLAN",
  "CRITERIA",
] as const;

export type RequiredPgrDocument = (typeof REQUIRED_PGR_DOCUMENTS)[number];

/** NR-1 1.5.4.4.6 / .6.1 — meses até revisão. */
export function assessmentReviewMonths(org: {
  assessmentReviewMonths: number;
  hasSstCertification: boolean;
}): number {
  const months = org.assessmentReviewMonths || 24;
  if (months > 24 && !org.hasSstCertification) {
    throw Object.assign(
      new Error(
        "Prazo de revisão acima de 24 meses exige certificação SST declarada.",
      ),
      { status: 400 },
    );
  }
  return months;
}
