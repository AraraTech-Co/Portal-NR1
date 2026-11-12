/**
 * Aviso de idade fora do comum: um ano digitado errado no nascimento passa
 * (a data existe) e trava o primeiro acesso da pessoa. Avisa abaixo de 14 e
 * acima de 100 anos, sem bloquear. A mesma regra do servidor, na prévia da
 * planilha (`server/src/helper/birth-date.ts`). [C4-8]
 */
export function idadeEm(nascimento: string, hoje: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(nascimento);
  if (!m) return null;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let idade = hoje.getFullYear() - a;
  if (hoje.getMonth() + 1 < me || (hoje.getMonth() + 1 === me && hoje.getDate() < d)) idade -= 1;
  return idade;
}

export function avisoDeIdade(nascimento: string | null | undefined, hoje: Date = new Date()): string | null {
  if (!nascimento) return null;
  const idade = idadeEm(nascimento, hoje);
  if (idade === null || (idade >= 14 && idade <= 100)) return null;
  return `Idade calculada: ${idade} ${idade === 1 ? "ano" : "anos"}. Confira a data.`;
}
