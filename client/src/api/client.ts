import { getToken } from "./token";

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      (data as { message?: string }).message || `Erro ${res.status}`,
      res.status,
      data as Record<string, unknown>,
    );
  }
  return data as T;
}

/**
 * O erro do servidor chega inteiro na tela.
 *
 * A mensagem sozinha dizia "O documento não confere com a pessoa escolhida."
 * e escondia o que o servidor já sabia: qual campo não bateu. [B2-3-B]
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(message: string, status: number, body: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  get code(): string | null {
    return typeof this.body.code === "string" ? this.body.code : null;
  }

  /** O que não conferiu, em português, como o servidor devolveu. */
  get reasons(): string[] {
    return Array.isArray(this.body.reasons)
      ? (this.body.reasons as unknown[]).map(String)
      : [];
  }
}
