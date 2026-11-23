/**
 * O pedido de entrada pede CPF e nascimento (23/11/2026). CPF válido e
 * inédito a cada chamada, para os testes que só precisam de um pedido.
 */
let sequencia = 0;

export function cpfFicticio(semente: number): string {
  const base = String(100000000 + (semente % 800000000));
  const digitos = base.split("").map(Number);
  const verificador = (tamanho: number) => {
    const soma = digitos.slice(0, tamanho).reduce((total, d, i) => total + d * (tamanho + 1 - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = verificador(9);
  digitos.push(d1);
  const d2 = verificador(10);
  return `${base}${d1}${d2}`;
}

export function identidadeDoPedido(): { tax_id: string; birth_date: string } {
  sequencia += 1;
  return { tax_id: cpfFicticio(Date.now() * 7 + sequencia * 7919), birth_date: "1990-05-10" };
}
