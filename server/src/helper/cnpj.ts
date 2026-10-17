/**
 * CNPJ do estabelecimento. Guardamos só os 14 dígitos: formatação é
 * apresentação, e "11.222.333/0001-81" e "11222333000181" são o mesmo.
 */
export function normalizeCnpj(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** Dígitos verificadores (módulo 11). Sequência repetida passa na conta, mas não é CNPJ. */
export function isValidCnpj(value: string): boolean {
  const cnpj = normalizeCnpj(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;

  const digits = cnpj.split("").map(Number);
  const checkDigit = (length: number) => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, w, i) => total + w * digits[i]!, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return checkDigit(12) === digits[12] && checkDigit(13) === digits[13];
}

/**
 * CNPJ do formulário: vazio vira nulo, preenchido tem de ser CNPJ de verdade.
 * Mesma regra para estabelecimento e para a empresa. [B2-1-M]
 */
export function cnpjOrNull(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  if (!isValidCnpj(String(raw))) {
    throw Object.assign(new Error("CNPJ inválido — confira os números."), {
      status: 400,
    });
  }
  return normalizeCnpj(String(raw));
}
