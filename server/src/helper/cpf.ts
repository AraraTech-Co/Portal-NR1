/**
 * CPF do colaborador.
 *
 * É obrigatório no ASO — "nome completo do empregado, o número de seu CPF e
 * sua função" (NR-7, 7.5.19.1 b). Guardamos só os 11 dígitos: formatação é
 * apresentação, e "123.456.789-09" e "12345678909" são a mesma pessoa.
 */
export function normalizeCpf(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** Dígitos verificadores (módulo 11). Sequência repetida passa na conta, mas não é CPF. */
export function isValidCpf(value: string): boolean {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const digits = cpf.split("").map(Number);
  const checkDigit = (length: number) => {
    const sum = digits
      .slice(0, length)
      .reduce((total, digit, index) => total + digit * (length + 1 - index), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return checkDigit(9) === digits[9] && checkDigit(10) === digits[10];
}
