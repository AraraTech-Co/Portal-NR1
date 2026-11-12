import { request } from "./client";

export type EmployeeRow = {
  id: string;
  userId: string;
  registration: string | null;
  taxId: string | null;
  phone: string | null;
  admittedAt: string | null;
  /** Nascimento: visível só para quem vê o CPF. [C1-7] */
  birthDate?: string | null;
  dismissedAt: string | null;
  dismissalReason: string | null;
  bond: string;
  contractorId: string | null;
  user: { id: string; name: string; login: string; email: string | null };
  jobRole: { id: string; name: string } | null;
  contractor: { id: string; name: string } | null;
  /** Filial (CNPJ) da pessoa: a da função ou, sem função, a escolhida. [C3-2] */
  establishment?: { id: string; name: string } | null;
};

/** Vínculo da pessoa com a empresa (NR-1 1.5.8). [S1-G] */
export const WORKER_BOND_LABEL: Record<string, string> = {
  EMPLOYEE: "Empregado",
  CONTRACTOR: "Terceirizado",
  TEMPORARY: "Temporário",
  APPRENTICE: "Aprendiz",
  INTERN: "Estagiário",
};

export type ImportRow = {
  name: string;
  registration?: string;
  tax_id?: string;
  email?: string;
  job_role_id?: string;
  admitted_at?: string;
  bond?: string;
  contractor_id?: string;
  org_role?: string;
  /** A filial da linha; obrigatória com mais de uma na empresa. [C3-3] */
  establishment_id?: string;
};

export type ImportResult = {
  line: number;
  name: string;
  status: "created" | "completed" | "skipped" | "error";
  /** O que a planilha preencheu na ficha de quem já existia. [CB-2] */
  filled?: string[];
  message?: string;
  login?: string;
  /** Conta nova aguardando o primeiro acesso: nenhuma senha sai daqui. [C1-7] */
  awaiting_first_access?: boolean;
  /** A filial em que a linha cai. [C3-3] */
  establishment?: { id: string; name: string } | null;
};

export type ImportReport = {
  dry_run: boolean;
  rows: number;
  created: number;
  completed: number;
  skipped: number;
  errors: number;
  results: ImportResult[];
};

export function importPeople(people: ImportRow[], dryRun: boolean) {
  return request<ImportReport>("/api/pessoas-acessos/importar", {
    method: "POST",
    body: JSON.stringify({ people, dry_run: dryRun }),
  });
}

export function updateEmployeeProfile(
  id: string,
  input: {
    bond?: string;
    contractor_id?: string | null;
    registration?: string;
    tax_id?: string;
    /** Só o RH altera, como o CPF. [C1-7] */
    birth_date?: string | null;
    phone?: string;
    job_role_id?: string | null;
    /** Só para quem fica sem função; com função, vale a filial dela. [C3-2] */
    establishment_id?: string;
    admitted_at?: string | null;
  },
) {
  return request<{ profile: EmployeeRow }>(
    `/api/employee-profiles/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export type RequirementStatus = {
  id: string;
  kind: string;
  name: string;
  validity_months: number | null;
  /** ok | missing | expired | pending | rejected */
  status: string;
  certificate: {
    id: string;
    name: string;
    issued_at: string | null;
    expires_at: string | null;
    has_file: boolean;
  } | null;
};

export type EmployeeFile = {
  profile: EmployeeRow & {
    dismissedBy: { id: string; name: string } | null;
    contractor: { id: string; name: string; taxId: string | null; relation: string } | null;
    jobRole:
      | {
          id: string;
          name: string;
          description: string | null;
          /** CBO do cargo. [PF-2] */
          cbo2002?: string | null;
          sector: { id: string; name: string; establishment: { id: string; name: string } };
        }
      | null;
  };
  membership: {
    role: string;
    access_expires_at: string | null;
    access_active: boolean;
  } | null;
  requirements: RequirementStatus[];
  certificates: {
    id: string;
    name: string;
    status: string;
    issuedAt: string | null;
    expiresAt: string | null;
    has_file: boolean;
  }[];
  exams: { id: string; kind: string; performedAt: string | null; dueAt: string | null }[];
  service_order: {
    id: string;
    version: number;
    issued_at: string;
    acknowledged_at: string | null;
  } | null;
  actions: { id: string; title: string; status: string; dueDate: string | null }[];
  history: {
    id: string;
    action: string;
    at: string;
    who: string;
    /** O que mudou, de quê para quê. Escondido para quem não vê o campo. [CB-54] */
    changes: {
      field: string;
      label: string;
      from: string | null;
      to: string | null;
      hidden: boolean;
    }[];
  }[];
};

export function fetchEmployees(includeDismissed = false) {
  const qs = includeDismissed ? "?include_dismissed=true" : "";
  return request<{ profiles: EmployeeRow[] }>(`/api/employee-profiles${qs}`).then(
    (d) => d.profiles,
  );
}

export function fetchEmployeeFile(id: string) {
  return request<EmployeeFile>(
    `/api/employee-profiles/${encodeURIComponent(id)}/ficha`,
  );
}

export function dismissEmployee(
  id: string,
  input: { dismissedAt?: string; reason?: string },
) {
  return request<{ profile: EmployeeRow; access_revoked: boolean }>(
    `/api/employee-profiles/${encodeURIComponent(id)}/desligamento`,
    {
      method: "POST",
      body: JSON.stringify({
        dismissed_at: input.dismissedAt,
        reason: input.reason,
      }),
    },
  );
}

export function reinstateEmployee(id: string) {
  return request<{ profile: EmployeeRow }>(
    `/api/employee-profiles/${encodeURIComponent(id)}/reverter-desligamento`,
    { method: "POST" },
  );
}

export const REQUIREMENT_STATUS_LABEL: Record<string, string> = {
  ok: "Em dia",
  missing: "Sem comprovante",
  expired: "Vencido",
  pending: "Em análise",
  rejected: "Recusado",
};

/** Os dados da planilha da folha guardados à parte da ficha. [PF-2] */
export type DadosDaFolha = {
  rg: string | null;
  pis: string | null;
  ctps_number: string | null;
  ctps_series: string | null;
  ctps_uf: string | null;
  salary_type: string | null;
  fgts_option_date: string | null;
  dependents: number | null;
  education_level: string | null;
  nationality_code: string | null;
  address: string | null;
  address_complement: string | null;
  district: string | null;
  city: string | null;
  termination_date: string | null;
  termination_cause: string | null;
  movement_type: string | null;
  competence: string | null;
  updated_at: string | null;
};

export function fetchDadosDaFolha(profileId: string) {
  return request<{ dados: DadosDaFolha | null; pode_editar: boolean }>(
    `/api/employee-profiles/${encodeURIComponent(profileId)}/dados-da-folha`,
  );
}

export function updateDadosDaFolha(
  profileId: string,
  input: Partial<Record<keyof DadosDaFolha, string | number | null>>,
) {
  return request<{ dados: DadosDaFolha | null; mudou: string[] }>(
    `/api/employee-profiles/${encodeURIComponent(profileId)}/dados-da-folha`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}
