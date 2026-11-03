import { request } from "./client";

export const TRAINING_KIND_LABEL: Record<string, string> = {
  ONLINE: "A distância",
  CLASSROOM: "Presencial",
};

export type TrainingSlide = {
  id: string;
  order: number;
  title: string | null;
  body: string | null;
};

export type TrainingQuestion = {
  id: string;
  order: number;
  prompt: string;
  options: string[];
  /** Só vem para quem cuida dos treinamentos. */
  correctIndex?: number;
};

export type MyEnrollment = {
  id: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  score: number | null;
  certificateCode: string | null;
  expiresAt: string | null;
  /** Emitido antes de existir nota mínima, com nota abaixo dela. [CB-31] */
  below_minimum?: boolean;
  /** Concluído que pode ser refeito: abaixo da nota de hoje, ou vencido. [CB-65] */
  can_retake?: boolean;
};

export type TrainingFull = {
  id: string;
  title: string;
  category: string;
  kind: string;
  summary: string | null;
  durationMinutes: number;
  passingScore: number;
  validityMonths: number | null;
  videoUrl: string | null;
  slides: TrainingSlide[];
  questions: TrainingQuestion[];
  my_enrollment: MyEnrollment | null;
  /**
   * A turma presencial para a qual a pessoa foi convocada e que ainda
   * espera a lista de presença. [B3-3-C]
   */
  my_session: MySession | null;
};

export type MySession = {
  id: string;
  held_at: string;
  location: string | null;
  instructor_name: string;
  duration_minutes: number;
  summon_id: string;
  attendance_status: string;
};

export type CompleteResult = {
  enrollment: MyEnrollment;
  passed: boolean;
  passing_score: number;
  message?: string;
};

export type SessionAttendance = {
  user: { id: string; name: string };
  present: boolean;
  score: number | null;
};

export type TrainingSession = {
  id: string;
  held_at: string;
  instructor_name: string;
  instructor_registration: string | null;
  instructor_qualification: string | null;
  location: string | null;
  duration_minutes: number;
  notes: string | null;
  recorded_by: { id: string; name: string };
  /** A lista de presença assinada, quando anexada. [CB-74] */
  papers: { id: string; fileName: string | null; description: string | null; uploadedAt: string }[];
  present: number;
  absent: number;
  attendances: SessionAttendance[];
};

export function fetchTraining(id: string) {
  return request<{ training: TrainingFull }>(
    `/api/trainings/${encodeURIComponent(id)}`,
  );
}

export function startTraining(id: string) {
  return request<{ enrollment: MyEnrollment }>(
    `/api/trainings/${encodeURIComponent(id)}/start`,
    { method: "POST" },
  );
}

export function completeTraining(
  id: string,
  answers: { question_id: string; index: number }[],
) {
  return request<CompleteResult>(
    `/api/trainings/${encodeURIComponent(id)}/complete`,
    { method: "POST", body: JSON.stringify({ answers }) },
  );
}

export function fetchTrainingSessions(id: string) {
  return request<{
    training: { id: string; title: string; kind: string };
    sessions: TrainingSession[];
  }>(`/api/trainings/${encodeURIComponent(id)}/turmas`);
}

export function recordTrainingSession(
  id: string,
  input: {
    held_at: string;
    instructor_name: string;
    instructor_registration?: string;
    /** Qualificação de quem deu a aula, para o certificado. [B3-3-G] */
    instructor_qualification?: string;
    location?: string;
    duration_minutes?: number;
    notes?: string;
    /** Turma que já aconteceu: quem esteve. */
    attendees?: { user_id: string; present: boolean; score?: number }[];
    /** Turma marcada para o futuro: quem convocar. [CB-34] */
    invite_user_ids?: string[];
  },
) {
  return request<{ session: { id: string } }>(
    `/api/trainings/${encodeURIComponent(id)}/turmas`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

/** Cadastrar treinamento pela tela, não só pela API. [CB-30] */
export function createTraining(input: {
  title: string;
  kind: string;
  summary?: string;
  duration_minutes?: number;
  passing_score?: number;
  validity_months?: number;
  /** O que o certificado pede (1.7.1.1). [B3-3-G] */
  instructor_name?: string;
  instructor_qualification?: string;
  technical_responsible_name?: string;
  technical_responsible_qualification?: string;
  questions?: Array<{
    prompt: string;
    options: string[];
    correct_index: number;
  }>;
}) {
  return request<{ training: { id: string; title: string } }>("/api/trainings", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type DadosDoCertificadoDoTreinamento = {
  instructor_name: string | null;
  instructor_qualification: string | null;
  technical_responsible_name: string | null;
  technical_responsible_qualification: string | null;
};

/** Quem ministra e o responsável técnico, nos treinamentos já cadastrados. [B3-3-G] */
export function updateTrainingCertificateData(
  id: string,
  input: DadosDoCertificadoDoTreinamento,
) {
  return request<{
    training: {
      id: string;
      instructorName: string | null;
      instructorQualification: string | null;
      technicalResponsibleName: string | null;
      technicalResponsibleQualification: string | null;
    };
  }>(`/api/trainings/${encodeURIComponent(id)}/certificado`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

/** Local e qualificação de quem deu a aula, na turma já registrada. [B4-B] */
export function updateTrainingSession(
  trainingId: string,
  sessionId: string,
  input: { location: string | null; instructor_qualification: string | null },
) {
  return request<{
    session: { id: string; location: string | null; instructor_qualification: string | null };
  }>(
    `/api/trainings/${encodeURIComponent(trainingId)}/turmas/${encodeURIComponent(sessionId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

/** Anexa o papel assinado da turma (lista de presença). [CB-74] */
export function addSessionPaper(
  trainingId: string,
  sessionId: string,
  input: { file_name: string; mime_type: string; content_base64: string; description?: string },
) {
  return request<{ paper: { id: string; fileName: string } }>(
    `/api/trainings/${encodeURIComponent(trainingId)}/turmas/${encodeURIComponent(sessionId)}/papel`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function sessionPaperUrl(trainingId: string, sessionId: string, evidenceId: string): string {
  return `/api/trainings/${encodeURIComponent(trainingId)}/turmas/${encodeURIComponent(sessionId)}/papel/${encodeURIComponent(evidenceId)}/file`;
}

/** A lista de presença de uma turma já marcada. [CB-34] */
export function recordSessionAttendance(
  trainingId: string,
  sessionId: string,
  attendees: { user_id: string; present: boolean; score?: number }[],
) {
  return request<{ ok: boolean; attendees: number }>(
    `/api/trainings/${encodeURIComponent(trainingId)}/turmas/${encodeURIComponent(sessionId)}/presenca`,
    { method: "POST", body: JSON.stringify({ attendees }) },
  );
}
