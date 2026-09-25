import { request } from "./client";

export type EmergencyProcedure = {
  id: string;
  scenario: string;
  firstAidMeans: string | null;
  responsibles: string | null;
  evacuationPlan: string | null;
  largeScaleMeasures: string | null;
  drillFrequencyMonths: number | null;
  drill_frequency_months: number;
  last_drill_at: string | null;
  archivedAt: string | null;
  establishment: { id: string; name: string };
  _count: { drills: number };
};

export type EmergencyProcedureDetail = EmergencyProcedure & {
  drills: {
    id: string;
    performedAt: string;
    participants: number | null;
    findings: string | null;
    recordedBy: { id: string; name: string };
    _count: { evidences: number };
  }[];
};

export async function fetchEmergencyProcedures(establishmentId?: string) {
  const qs = establishmentId
    ? `?establishment_id=${encodeURIComponent(establishmentId)}`
    : "";
  return request<{ procedures: EmergencyProcedure[] }>(
    `/api/emergency-procedures${qs}`,
  );
}

export async function fetchEmergencyProcedure(id: string) {
  return request<{ procedure: EmergencyProcedureDetail }>(
    `/api/emergency-procedures/${id}`,
  );
}

export async function createEmergencyProcedure(input: {
  establishmentId: string;
  scenario: string;
  firstAidMeans: string;
  responsibles: string;
  evacuationPlan: string;
  largeScaleMeasures?: string;
  drillFrequencyMonths?: number;
}) {
  return request<{ procedure: { id: string } }>("/api/emergency-procedures", {
    method: "POST",
    body: JSON.stringify({
      establishment_id: input.establishmentId,
      scenario: input.scenario,
      first_aid_means: input.firstAidMeans,
      responsibles: input.responsibles,
      evacuation_plan: input.evacuationPlan,
      large_scale_measures: input.largeScaleMeasures,
      drill_frequency_months: input.drillFrequencyMonths,
    }),
  });
}

export async function createEmergencyDrill(
  procedureId: string,
  input: {
    performedAt: string;
    participants?: number;
    findings?: string;
  },
) {
  return request<{ drill: { id: string } }>(
    `/api/emergency-procedures/${procedureId}/drills`,
    {
      method: "POST",
      body: JSON.stringify({
        performed_at: input.performedAt,
        participants: input.participants,
        findings: input.findings,
      }),
    },
  );
}

export type DrillStatus =
  | "NO_SCHEDULE"
  | "NEVER_DONE"
  | "OVERDUE"
  | "DUE_SOON"
  | "OK";

export function drillStatus(p: {
  last_drill_at: string | null;
  drill_frequency_months: number;
}): DrillStatus {
  const months = p.drill_frequency_months;
  if (!months || months <= 0) return "NO_SCHEDULE";
  if (!p.last_drill_at) return "NEVER_DONE";
  const last = new Date(p.last_drill_at).getTime();
  if (Number.isNaN(last)) return "NEVER_DONE";
  const due = last + months * 30.44 * 24 * 60 * 60 * 1000;
  const soon = due - 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  if (now > due) return "OVERDUE";
  if (now > soon) return "DUE_SOON";
  return "OK";
}
