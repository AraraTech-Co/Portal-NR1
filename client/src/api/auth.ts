import { request } from "./client";
import { clearToken, getToken, setToken } from "./token";

export { clearToken, getToken, setToken };

export type ModuleAccessLevel = "read" | "write";

export type SessionUser = {
  id: string;
  login: string;
  email: string | null;
  name: string;
  account_role: string | null;
  is_master: boolean;
  role: string;
  permission: string;
  must_change_password: boolean;
  /** Módulos visíveis: read | write (omite none / X). */
  modules: Record<string, ModuleAccessLevel>;
  organization: { id: string; name: string };
  account: { id: string; name: string };
};

export async function login(loginId: string, password: string) {
  const data = await request<{ token: string; user: SessionUser }>(
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
  return request<{ user: SessionUser; accounts: unknown[] }>("/api/auth");
}

export async function logout() {
  try {
    await request("/api/auth", { method: "DELETE" });
  } finally {
    clearToken();
  }
}
