/**
 * Matrícula só com ASCII imprimível (U+0021–U+007E), conferida depois de
 * aparada. [C3-2]
 *
 * A folha usa número, e "MAT-001" continua valendo. Letra acentuada, "ß",
 * espaço no meio e qualquer outro caractere ficam de fora: banco e servidor
 * não põem essas letras em maiúsculas do mesmo jeito, e a chave da matrícula
 * divergiria. O banco tem a mesma regra numa CHECK sobre a chave.
 */
export const MATRICULA_FORA_DO_PADRAO =
  "A matrícula aceita só letras sem acento, números e símbolos do teclado, sem espaço no meio.";

export function matriculaNoPadrao(aparada: string): boolean {
  return /^[\x21-\x7E]+$/.test(aparada);
}
