import { request } from "./client";
import { clearToken, getToken, setToken } from "./token";

export { clearToken, getToken, setToken };

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
