import {
  ASSESSMENT_REVIEW_MONTHS_DEFAULT,
  REQUIRED_PGR_DOCUMENTS,
  type RequiredPgrDocument,
} from "../constants";

export { REQUIRED_PGR_DOCUMENTS, type RequiredPgrDocument };

/** NR-1 1.5.4.4.6 / .6.1 — meses até revisão. */
export function assessmentReviewMonths(org: {
  assessmentReviewMonths: number;
  hasSstCertification: boolean;
}): number {
  const months = org.assessmentReviewMonths || ASSESSMENT_REVIEW_MONTHS_DEFAULT;
  if (months > ASSESSMENT_REVIEW_MONTHS_DEFAULT && !org.hasSstCertification) {
    throw Object.assign(
      new Error(
        `Prazo de revisão acima de ${ASSESSMENT_REVIEW_MONTHS_DEFAULT} meses exige certificação SST declarada.`,
      ),
      { status: 400 },
    );
  }
  return months;
}
