const TOKEN_KEY = "portal_nr1_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export type SessionUser = {
  id: string;
  login: string;
  email: string | null;
  name: string;
  account_role: string | null;
  is_master: boolean;
  role: string;
  permission: string;
  grants: string[];
  must_change_password: boolean;
  organization: { id: string; name: string };
  account: { id: string; name: string };
};

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { message?: string }).message || `Erro ${res.status}`,
    );
  }
  return data as T;
}

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
