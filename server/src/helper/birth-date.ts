import { zonedDate } from "./business-days";

/**
 * Data de nascimento: dia de calendário real e no passado, gravado à
 * meia-noite UTC como as outras datas sem hora. Nenhuma faixa de idade:
 * limites como "14 a 100 anos" excluiriam cadastros válidos. [C1-7]
 *
 * Aceita AAAA-MM-DD e dd/mm/aaaa. Vazio vira nulo.
 */
export function parseBirthDate(raw: unknown): Date | null {
  if (raw === undefined || raw === null) return null;
  const valor = String(raw).trim();
  if (valor === "") return null;
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor.slice(0, 10));
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (br) [y, m, d] = [Number(br[3]), Number(br[2]), Number(br[1])];
  else throw invalida("Data de nascimento inválida — use dd/mm/aaaa.");

  const data = new Date(Date.UTC(y, m - 1, d));
  if (data.getUTCFullYear() !== y || data.getUTCMonth() !== m - 1 || data.getUTCDate() !== d) {
    throw invalida("Data de nascimento inválida — esse dia não existe.");
  }
  const hoje = zonedDate(new Date());
  if (data.getTime() >= Date.UTC(hoje.year, hoje.month - 1, hoje.day)) {
    throw invalida("Data de nascimento precisa ser no passado.");
  }
  return data;
}

function invalida(message: string) {
  return Object.assign(new Error(message), { status: 400, field: "birth_date" });
}

/** Mesma data de calendário (as duas gravadas à meia-noite UTC). */
export function sameBirthDate(a: Date | null | undefined, b: Date | null | undefined): boolean {
  return Boolean(a && b && a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10));
}
