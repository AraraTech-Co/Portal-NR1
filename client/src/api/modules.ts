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

export const fetchLeaves = () =>
  request<{
    leaves: Array<{
      id: string;
      kind: string;
      status: string;
      startDate: string;
      endDate: string;
      days: number;
      user: { name: string };
    }>;
  }>("/api/leaves").then((d) => d.leaves);

export const fetchTimeEntries = () =>
  request<{
    entries: Array<{
      id: string;
      day: string;
      balanceMinutes: number;
      note: string | null;
      userId: string;
    }>;
  }>("/api/time-entries").then((d) => d.entries);

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
      durationMinutes: number;
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
      status: string;
      isAnonymous: boolean;
      createdAt: string;
      establishment: { name: string } | null;
      _count: { messages: number };
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

export type AccessibleAccount = {
  id: string;
  name: string;
  account_role: string | null;
  via_master: boolean;
  organization: { id: string; name: string };
};

export const fetchAccessibleAccounts = () =>
  request<{ accounts: AccessibleAccount[] }>("/api/auth").then(
    (d) => d.accounts ?? [],
  );

export const switchAccount = (accountId: string) =>
  request<{ token: string; user: import("./auth").SessionUser }>(
    "/api/auth/switch",
    {
      method: "POST",
      body: JSON.stringify({ account_id: accountId }),
    },
  );
