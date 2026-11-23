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

/**
 * Para a edição: recusa só APAGAR — a ficha tem o dado e o corpo manda a
 * chave vazia. Chave ausente não muda nada, e vazio sobre vazio também não:
 * a tela da ficha manda os três sempre, e a ficha antiga sem nascimento
 * continua editável nos outros campos.
 */
export function apagaIdentidade(
  body: Record<string, unknown>,
  atual: { birthDate: Date | null; taxId: string | null; registration: string | null },
): string | null {
  const apaga = (chave: string, tem: unknown) => chave in body && vazio(body[chave]) && !vazio(tem);
  if (apaga("birth_date", atual.birthDate)) return FALTA_NASCIMENTO;
  if (apaga("tax_id", atual.taxId)) return FALTA_CPF;
  if (apaga("registration", atual.registration)) return FALTA_MATRICULA;
  return null;
}
