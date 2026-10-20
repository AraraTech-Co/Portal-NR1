import { request } from "./client";
import { clearToken, getToken, setToken } from "./token";

export { clearToken, getToken, setToken };

export type ModuleAccessLevel = "read" | "write";

export type SessionUser = {
  id: string;
  login: string;
  email: string | null;
  name: string;
  is_master: boolean;
  role: string;
  permission: string;
  must_change_password: boolean;
  /** Módulos visíveis: read | write (omite none / X). */
  modules: Record<string, ModuleAccessLevel>;
  organization: { id: string; name: string };
  account: { id: string; name: string };
};

/**
 * Conta que a pessoa alcança. Vem junto com a sessão desde sempre; o portal
 * só mostrava a lista dentro de Conta e usuários. [S1-K]
 */
export type AccessibleAccount = {
  id: string;
  name: string;
  org_role: string | null;
  via_master: boolean;
  organization: { id: string; name: string };
};

export async function login(loginId: string, password: string) {
  const data = await request<{
    token: string;
    user: SessionUser;
    accounts: AccessibleAccount[];
  }>(
    "/api/auth",
    {
      method: "POST",
      body: JSON.stringify({ login: loginId, password }),
    },
  );
  setToken(data.token);
  return data;
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
) {
  return request<{ user: SessionUser }>("/api/auth/password", {
    method: "POST",
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
}

export async function fetchSession() {
  return request<{ user: SessionUser; accounts: AccessibleAccount[] }>(
    "/api/auth",
  );
}

/** Trocar a conta ativa sem sair do portal. [S1-K] */
export async function switchAccount(accountId: string) {
  return request<{
    token: string;
    user: SessionUser;
    accounts: AccessibleAccount[];
  }>("/api/auth/switch", {
    method: "POST",
    body: JSON.stringify({ account_id: accountId }),
  });
}

export async function logout() {
  try {
    await request("/api/auth", { method: "DELETE" });
  } finally {
    clearToken();
  }
}
