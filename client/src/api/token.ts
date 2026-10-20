/** A chave é exportada para a sessão saber quando outra aba a trocou. [CB-25] */
export const TOKEN_KEY = "portal_nr1_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}
