import { request } from "./client";

/**
 * Primeiro acesso por conferência de dados. [C1-7]
 *
 * Etapa 1: matrícula, CPF e nascimento conferem → uma ficha de ativação de
 * uso único, que vale 10 minutos. Etapa 2: com ela, a pessoa cria a senha.
 */
export function verifyFirstAccess(input: { matricula: string; cpf: string; nascimento: string }) {
  return request<{ token: string; expires_in: number }>("/api/auth/primeiro-acesso", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createFirstPassword(input: {
  token: string;
  password: string;
  password_confirmation: string;
}) {
  return request<{ ok: true }>("/api/auth/primeiro-acesso/senha", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
