import { request } from "./client";

export type InviteLink = {
  id: string;
  token: string;
  path: string;
  label: string | null;
  role_mode: "FIXED" | "ON_APPROVE";
  role: string;
  org_role: string;
  active: boolean;
  expires_at: string | null;
  max_uses: number | null;
  used_count: number;
  created_at: string;
};

export type JoinRequest = {
  id: string;
  account_id: string;
  account_name: string;
  name: string;
  /** Opcional desde a decisão OB-1. */
  email: string | null;
  registration: string | null;
  is_external: boolean;
  created_at: string;
  invite_link_id: string | null;
  role_mode: "FIXED" | "ON_APPROVE";
  suggested_org_role: string | null;
  invite_label: string | null;
};

export type AssignableRoles = {
  org_roles: string[];
};

export function fetchInviteLinks() {
  return request<{ links: InviteLink[]; assignable: AssignableRoles }>(
    "/api/invite-links",
  );
}

export function createInviteLink(input: {
  label?: string;
  max_uses?: number | null;
  role_mode?: "FIXED" | "ON_APPROVE";
  org_role?: string;
}) {
  return request<{ link: InviteLink }>("/api/invite-links", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deactivateInviteLink(id: string) {
  return request<{ ok: boolean; id: string; active: boolean }>(
    `/api/invite-links/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify({ active: false }),
    },
  );
}

export function fetchJoinRequests() {
  return request<{
    requests: JoinRequest[];
    assignable: AssignableRoles;
  }>("/api/join-requests");
}

export function decideJoinRequest(
  id: string,
  input: {
    action: "approve" | "reject";
    org_role?: string;
    /** Matrícula e vínculo são definidos por quem aprova. [S1-M] */
    registration?: string;
    is_external?: boolean;
    note?: string;
    /** Fim do acesso do fiscal (AAAA-MM-DD). Vazio → 30 dias. */
    access_until?: string;
  },
) {
  return request<{ ok: boolean; status: string; access_expires_at?: string }>(
    `/api/join-requests/${id}/decide`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function fetchPublicInvite(token: string) {
  return request<{
    account_name: string;
    organization_name: string;
    label: string | null;
  }>(`/api/invites/${token}`);
}

export function acceptPublicInvite(
  token: string,
  input: {
    name: string;
    /** O portal não envia nem confirma e-mail: é opcional. [OB-1] */
    email?: string;
    password: string;
  },
) {
  return request<{
    ok: boolean;
    pending: boolean;
    email: string | null;
    account_name: string;
    request_id: string;
  }>(`/api/invites/${token}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
