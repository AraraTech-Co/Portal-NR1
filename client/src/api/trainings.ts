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
    attendees: { user_id: string; present: boolean; score?: number }[];
  },
) {
  return request<{ session: { id: string } }>(
    `/api/trainings/${encodeURIComponent(id)}/turmas`,
    { method: "POST", body: JSON.stringify(input) },
  );
}
