import { request } from "./client";

export const fetchAeps = () =>
  request<{
    aeps: Array<{
      id: string;
      status: string;
      method: string;
      conductedAt: string;
      scopeDescription: string;
      establishment: { name: string };
      sector: { name: string } | null;
      conductedBy: { name: string };
      _count: { hazards: number; evidences: number };
    }>;
  }>("/api/aeps").then((d) => d.aeps);

export const fetchContractors = () =>
  request<{
    contractors: Array<{
      id: string;
      name: string;
      relation: string;
      documentsReceivedAt: string | null;
      risksInformedAt: string | null;
      establishment: { name: string } | null;
    }>;
  }>("/api/contractors").then((d) => d.contractors);

export const fetchParticipations = () =>
  request<{
    participations: Array<{
      id: string;
      type: string;
      subject: string;
      occurredAt: string;
      establishment: { name: string } | null;
      recordedBy: { name: string };
      _count: { evidences: number };
    }>;
  }>("/api/participations").then((d) => d.participations);

export type ParticipationEvidence = {
  id: string;
  fileName: string | null;
  description: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedAt: string;
};

/** O registro aberto, com a evidência que a própria tela pedia. [B3-4-B] */
export const fetchParticipation = (id: string) =>
  request<{
    participation: {
      id: string;
      type: string;
      subject: string;
      description: string | null;
      occurredAt: string;
      participantsCount: number | null;
      establishment: { id: string; name: string } | null;
      recordedBy: { id: string; name: string };
      evidences: ParticipationEvidence[];
    };
  }>(`/api/participations/${id}`).then((d) => d.participation);

/**
 * Anexar a lista de presença, a foto ou a ata. Opcional: a decisão B3-4-F
 * pôs o registro do portal como prova e o papel como anexo. [B3-4-B]
 */
export const addParticipationEvidence = (
  id: string,
  input: { file_name: string; mime_type: string; content_base64: string; description?: string },
) =>
  request<{ evidence: ParticipationEvidence }>(
    `/api/participations/${id}/evidences`,
    { method: "POST", body: JSON.stringify(input) },
  );

export const participationEvidenceUrl = (id: string, evidenceId: string) =>
  `/api/participations/${id}/evidences/${evidenceId}/file`;

export const fetchEmployeeProfiles = () =>
  request<{
    profiles: Array<{
      id: string;
      userId: string;
      registration: string | null;
      taxId: string | null;
      admittedAt: string | null;
      dismissedAt: string | null;
      user: { id: string; name: string; login: string };
      jobRole: { name: string } | null;
    }>;
  }>("/api/employee-profiles").then((d) => d.profiles);

export const fetchHrDocuments = () =>
  request<{
    documents: Array<{
      id: string;
      title: string;
      kind: string;
      createdAt: string;
      target: { name: string } | null;
      publishedBy: { name: string };
      my_ack: { acknowledgedAt: string | null } | null;
      _count: { acks: number };
    }>;
  }>("/api/hr-documents").then((d) => d.documents);

export const fetchPayslips = () =>
  request<{
    payslips: Array<{
      id: string;
      referenceMonth: number;
      referenceYear: number;
      publishedAt: string;
      user: { name: string };
    }>;
  }>("/api/payslips").then((d) => d.payslips);

export const fetchOnboardingSteps = () =>
  request<{
    steps: Array<{
      id: string;
      order: number;
      title: string;
      description: string | null;
      done_at: string | null;
    }>;
  }>("/api/onboarding-steps").then((d) => d.steps);

export const fetchReferrals = () =>
  request<{
    referrals: Array<{
      id: string;
      candidateName: string;
      position: string;
      status: string;
      createdAt: string;
    }>;
  }>("/api/referrals").then((d) => d.referrals);

export const fetchJobRoleRequirements = () =>
  request<{
    requirements: Array<{
      id: string;
      kind: string;
      name: string;
      jobRole: { name: string };
      /** O curso do portal que atende a exigência. [CB-70] */
      training: { id: string; title: string } | null;
    }>;
  }>("/api/job-role-requirements").then((d) => d.requirements);

export const fetchWorkerCertificates = () =>
  request<{
    certificates: Array<{
      id: string;
      name: string;
      status: string;
      expiresAt: string | null;
      userId: string;
      fileName: string | null;
      has_file: boolean;
      user?: { id: string; name: string };
    }>;
  }>("/api/worker-certificates").then((d) => d.certificates);

export const fetchOccupationalExams = () =>
  request<{
    exams: Array<{
      id: string;
      kind: string;
      performedAt: string | null;
      dueAt: string | null;
      fit: boolean | null;
      userId: string;
      user?: { id: string; name: string };
    }>;
  }>("/api/occupational-exams").then((d) => d.exams);

export type MedicalCertificateRow = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  startDate: string;
  days: number;
  /** Preenchido quando o atestado é de horas, não de dias. [S5-C] */
  hours: number | null;
  cid: string | null;
  reason: string | null;
  fileName: string | null;
  has_file: boolean;
  rejectionReason: string | null;
  reviewedAt: string | null;
  readByWorkerAt: string | null;
  createdAt: string;
  user: { id: string; name: string };
  reviewedBy: { id: string; name: string } | null;
};

export const fetchMedicalCertificates = () =>
  request<{ certificates: MedicalCertificateRow[] }>("/api/medical-certificates").then(
    (d) => d.certificates,
  );

export const sendMedicalCertificate = (input: {
  start_date: string;
  days: number;
  /** Declaração de comparecimento: o afastamento é de horas. [S5-C] */
  hours?: number;
  reason?: string;
  cid?: string;
  file_name?: string;
  mime_type?: string;
  content_base64?: string;
}) =>
  request<{ certificate: MedicalCertificateRow }>("/api/medical-certificates", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const reviewMedicalCertificate = (
  id: string,
  input: { status: "APPROVED" | "REJECTED"; rejection_reason?: string },
) =>
  request<{ certificate: MedicalCertificateRow }>(`/api/medical-certificates/${id}/review`, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const markMedicalCertificateRead = (id: string) =>
  request(`/api/medical-certificates/${id}/read`, { method: "POST" });

export const fetchTrainings = () =>
  request<{
    trainings: Array<{
      id: string;
      title: string;
      category: string;
      kind: string;
      durationMinutes: number;
      passingScore: number;
      archivedAt: string | null;
      _count?: { enrollments: number };
    }>;
  }>("/api/trainings").then((d) => d.trainings);

export type TrainingEnrollmentRow = {
  id: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  score: number | null;
  certificateCode: string | null;
  expiresAt: string | null;
  /** Emitido antes de existir nota mínima, com nota abaixo dela. [CB-31] */
  below_minimum: boolean;
  user: { id: string; name: string };
};

/** Quem fez o treinamento — para quem cuida dos treinamentos e para a fiscalização. */
export const fetchTrainingEnrollments = (id: string) =>
  request<{ enrollments: TrainingEnrollmentRow[] }>(
    `/api/trainings/${encodeURIComponent(id)}/enrollments`,
  ).then((d) => d.enrollments);

export const fetchEthicsReports = () =>
  request<{
    reports: Array<{
      id: string;
      protocol: string;
      category: string;
      /** O começo do relato, para a lista não ser só protocolos. [B2-3-D] */
      description: string;
      status: string;
      isAnonymous: boolean;
      createdAt: string;
      establishment: { name: string } | null;
      _count: { messages: number };
      unread_from_reporter: number;
      /** Zero = o comitê nunca falou nesta denúncia. [B2-3-D] */
      committee_messages: number;
    }>;
  }>("/api/ethics-reports").then((d) => d.reports);

export const fetchClimateSurveys = () =>
  request<{
    surveys: Array<{
      id: string;
      title: string;
      status: string;
      createdAt: string;
      _count?: { responses: number };
    }>;
  }>("/api/climate-surveys").then((d) => d.surveys);

export const fetchIdeas = () =>
  request<{
    ideas: Array<{
      id: string;
      title: string;
      status: string;
      createdAt: string;
      author: { name: string };
    }>;
  }>("/api/ideas").then((d) => d.ideas);

export const fetchAnnouncements = () =>
  request<{
    announcements: Array<{
      id: string;
      title: string;
      body: string;
      kind: string;
      createdAt: string;
      read_at: string | null;
      publishedBy: { name: string };
      _count: { reads: number };
    }>;
  }>("/api/announcements").then((d) => d.announcements);

export const fetchRewards = () =>
  request<{
    rewards: Array<{
      id: string;
      name: string;
      /** O que é o prêmio, quando quem publicou explicou. [OB-4] */
      description: string | null;
      cost: number;
      stock: number | null;
      archivedAt: string | null;
    }>;
  }>("/api/rewards").then((d) => d.rewards);

export const fetchPointsBalance = () =>
  request<{ balance: number }>("/api/points/balance").then((d) => d.balance);

export const fetchSummons = () =>
  request<{
    summons: Array<{
      id: string;
      title: string;
      scheduledFor: string;
      createdBy: { name: string };
      _count: { attendances: number };
      my_attendance: { status: string } | null;
    }>;
  }>("/api/summons").then((d) => d.summons);

/*
  Conta ativa e troca de conta moram em `api/auth.ts` e na sessão: eram duas
  listas, uma desta tela e outra do menu, que podiam discordar. [S1-K]
*/
export type { AccessibleAccount } from "./auth";

/*
  As telas que só listavam ganham porta de entrada: o servidor sempre
  aceitou criar, e faltava a tela. [OB-4] [CB-14] [CB-45]
*/

/** Pesquisa de clima: nasce como rascunho, com as perguntas. [OB-4] */
export const createClimateSurvey = (input: {
  title: string;
  description?: string;
  is_anonymous?: boolean;
  questions?: Array<{ order: number; prompt: string }>;
}) =>
  request<{ survey: { id: string } }>("/api/climate-surveys", {
    method: "POST",
    body: JSON.stringify(input),
  });

/** Convocação para reunião, CIPA, treinamento. [OB-4] */
export const createSummon = (input: {
  title: string;
  description?: string;
  scheduled_for: string;
  location?: string;
  invitee_ids?: string[];
}) =>
  request<{ summon: { id: string } }>("/api/summons", {
    method: "POST",
    body: JSON.stringify(input),
  });

/** Passo do roteiro de integração de quem chega. [OB-4] */
export const createOnboardingStep = (input: {
  order: number;
  title: string;
  description?: string;
}) =>
  request<{ step: { id: string } }>("/api/onboarding-steps", {
    method: "POST",
    body: JSON.stringify(input),
  });

/** Indicação de candidato por quem já trabalha aqui. [OB-4] */
export const createReferral = (input: {
  candidate_name: string;
  position: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  note?: string;
}) =>
  request<{ referral: { id: string } }>("/api/referrals", {
    method: "POST",
    body: JSON.stringify(input),
  });

/** Ideia de quem faz o trabalho. [OB-4] */
export const createIdea = (input: { title: string; description: string }) =>
  request<{ idea: { id: string } }>("/api/ideas", {
    method: "POST",
    body: JSON.stringify(input),
  });

/** Registro de participação dos trabalhadores — NR-1 1.5.3.2. [CB-45] */
export const createParticipation = (input: {
  type: string;
  subject: string;
  occurred_at: string;
  description?: string;
  establishment_id?: string;
  participants_count?: number;
}) =>
  request<{ participation: { id: string } }>("/api/participations", {
    method: "POST",
    body: JSON.stringify(input),
  });

/** Avaliação ergonômica aberta pelo SST, sem partir de uma queixa. [CB-45] */
export const createAep = (input: {
  establishment_id: string;
  scope_description: string;
  method?: string;
  sector_id?: string;
  method_rationale?: string;
  anonymity_measures?: string;
  workers_consulted?: number;
}) =>
  request<{ aep: { id: string } }>("/api/aeps", {
    method: "POST",
    body: JSON.stringify(input),
  });

// ---- Gamificação: a tela mostrava saldo e prêmios, e nada se podia fazer. [OB-4]

export type PointRule = { id: string; activity: string; points: number };

export const fetchPointRules = () =>
  request<{ rules: PointRule[] }>("/api/point-rules").then((d) => d.rules);

export const savePointRule = (input: { activity: string; points: number }) =>
  request<{ rule: PointRule }>("/api/point-rules", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const grantPoints = (input: {
  user_id: string;
  activity: string;
  points: number;
  note?: string;
}) =>
  request("/api/point-entries", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const createReward = (input: {
  name: string;
  cost: number;
  description?: string;
  stock?: number;
}) =>
  request("/api/rewards", { method: "POST", body: JSON.stringify(input) });

export const redeemReward = (rewardId: string) =>
  request(`/api/rewards/${encodeURIComponent(rewardId)}/redeem`, {
    method: "POST",
  });

export type Redemption = {
  id: string;
  status: string;
  cost: number;
  createdAt: string;
  decidedAt: string | null;
  user: { id: string; name: string };
  reward: { id: string; name: string };
  decidedBy: { id: string; name: string } | null;
};

export const fetchRedemptions = () =>
  request<{ redemptions: Redemption[]; manages: boolean }>(
    "/api/reward-redemptions",
  );

export const decideRedemption = (id: string, status: string) =>
  request(`/api/reward-redemptions/${encodeURIComponent(id)}/decide`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });

/*
  O Painel da fiscalização cobrava cadastros que não tinham tela: a empresa
  fazia tudo o que o portal permitia e o cartão continuava pendente. [B2-4-C]
*/

/** O que a função exige: certificado, exame ou treinamento. [B2-4-C] */
export const createJobRoleRequirement = (input: {
  job_role_id: string;
  name: string;
  kind?: string;
  description?: string;
  validity_months?: number;
  /**
   * O curso do portal que atende esta exigência. O campo existia só no
   * servidor, então o Painel nunca contava o curso concluído aqui dentro.
   * [CB-70] [S7-G]
   */
  training_id?: string;
}) =>
  request("/api/job-role-requirements", {
    method: "POST",
    body: JSON.stringify(input),
  });

/** Exame ocupacional de uma pessoa. [B2-4-C] */
export const createOccupationalExam = (input: {
  user_id: string;
  kind?: string;
  performed_at?: string;
  due_at?: string;
  fit?: boolean;
}) =>
  request("/api/occupational-exams", {
    method: "POST",
    body: JSON.stringify(input),
  });

/** Concluir a avaliação ergonômica — o painel pede a concluída. [B2-4-C] */
export const concludeAep = (
  id: string,
  input: { findings?: string; needs_aet?: boolean; aet_reason?: string },
) =>
  request(`/api/aeps/${encodeURIComponent(id)}/conclude`, {
    method: "POST",
    body: JSON.stringify(input),
  });
