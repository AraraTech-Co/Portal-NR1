import { request } from "./client";

/** O certificado do treinamento como documento, não como código. [B2-3-C] */
export type TrainingCertificate = {
  code: string;
  completed_at: string | null;
  expires_at: string | null;
  score: number | null;
  passing_score: number;
  /** Emitido antes de existir nota mínima, com nota abaixo dela. [CB-31] */
  below_minimum: boolean;
  person: {
    name: string;
    registration: string | null;
    job_role: string | null;
  };
  training: {
    title: string;
    kind: string;
    summary: string | null;
    duration_minutes: number;
    validity_months: number | null;
  };
  session: {
    held_at: string;
    location: string | null;
    instructor_name: string;
    instructor_registration: string | null;
  } | null;
  organization: { name: string; taxId: string | null } | null;
};

export function fetchTrainingCertificate(enrollmentId: string) {
  return request<{ certificate: TrainingCertificate }>(
    `/api/certificados/${encodeURIComponent(enrollmentId)}`,
  ).then((d) => d.certificate);
}
