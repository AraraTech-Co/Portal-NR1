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
  location: string | null;
  duration_minutes: number;
  notes: string | null;
  recorded_by: { id: string; name: string };
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
