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
  /**
   * Módulos que a pessoa alcança só pela consulta própria (ficha ativa):
   * holerites, férias e atestados, vendo só o que é seu. [C2-1]
   */
  own_modules?: string[];
  /** Unidades sob a responsabilidade de gerente, supervisor ou ADM loja. [C2-13] */
  managed_units?: string[];
  /** Recortado por unidade e sem nenhuma atribuída: mostra o aviso. [C2-13] */
  needs_units?: boolean;
  /** Só para o Master: a tela de login não sabe de qual empresa mostrar as filiais. [C3-2b] */
  login_without_establishments?: boolean;
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

/** As filiais da tela de entrada: id e nome. [C3-2b] */
export async function fetchLoginEstablishments() {
  return request<{ establishments: { id: string; name: string }[] }>("/api/auth/filiais");
}

/** A opção de quem não tem ficha (Master, RH e SST da central). [C3-2b] */
export const EXTERNO = "externo";

export async function login(loginId: string, password: string, establishmentId: string) {
  const data = await request<{
    token: string;
    user: SessionUser;
    accounts: AccessibleAccount[];
  }>(
    "/api/auth",
    {
      method: "POST",
      body: JSON.stringify({ login: loginId, password, establishment_id: establishmentId }),
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
