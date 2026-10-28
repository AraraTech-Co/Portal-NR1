/**
 * Senha dos usuários `master` e `admin` que o seed cria.
 *
 * Em produção ela vem de SEED_ADMIN_PASSWORD: vale só para o primeiro acesso
 * (a pessoa troca ao entrar) e não substitui a senha de quem já existe. Sem a
 * variável, o seed não roda em produção. Fora de produção continua a senha
 * conhecida que os testes usam.
 */
export function senhaInicial(env: NodeJS.ProcessEnv = process.env): {
  senha: string;
  definida: boolean;
} {
  const definida = env.SEED_ADMIN_PASSWORD?.trim();
  if (definida) {
    if (definida.length < 12) {
      throw new Error("SEED_ADMIN_PASSWORD precisa de pelo menos 12 caracteres.");
    }
    return { senha: definida, definida: true };
  }
  if (env.NODE_ENV === "production") {
    throw new Error(
      "Em produção o seed exige SEED_ADMIN_PASSWORD com a senha inicial do admin e do master.",
    );
  }
  return { senha: "admin123", definida: false };
}
