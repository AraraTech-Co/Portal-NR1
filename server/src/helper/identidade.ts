/**
 * A identidade de quem tem ficha: matrícula, CPF e data de nascimento. O
 * primeiro acesso confere os três na mesma ficha, e todo cadastro de pessoa
 * com ficha exige os três (decisão do Léo em 23/11/2026). Texto só com
 * espaço conta como vazio.
 */
export const FALTA_NASCIMENTO = "Informe a data de nascimento: é com ela que a pessoa faz o primeiro acesso.";
export const FALTA_CPF = "Informe o CPF: o primeiro acesso pede matrícula, CPF e data de nascimento.";
export const FALTA_MATRICULA = "Informe a matrícula: o primeiro acesso pede matrícula, CPF e data de nascimento.";

const vazio = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (v instanceof Date && Number.isNaN(v.getTime()));

/** O primeiro que falta, na ordem nascimento, CPF, matrícula; nulo quando há os três. */
export function faltaNaIdentidade(p: { nascimento: unknown; cpf: unknown; matricula: unknown }): string | null {
  if (vazio(p.nascimento)) return FALTA_NASCIMENTO;
  if (vazio(p.cpf)) return FALTA_CPF;
  if (vazio(p.matricula)) return FALTA_MATRICULA;
  return null;
}

/** Para a edição: a chave presente e vazia apaga o dado, e isso é recusado. Ausente não muda nada. */
export function apagaIdentidade(body: Record<string, unknown>): string | null {
  const apaga = (chave: string) => chave in body && vazio(body[chave]);
  if (apaga("birth_date")) return FALTA_NASCIMENTO;
  if (apaga("tax_id")) return FALTA_CPF;
  if (apaga("registration")) return FALTA_MATRICULA;
  return null;
}
