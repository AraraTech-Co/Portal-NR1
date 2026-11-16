/**
 * Como a pessoa entra com a senha provisória, para quem redefiniu passar
 * junto com a senha. Com a filial escolhida, a tela aceita login, matrícula
 * ou CPF; em "Externo", o login. O "Primeiro acesso" não vale depois da
 * redefinição.
 */
export function comoEntrarComSenhaProvisoria(p: { login: string; registration: string | null }): string {
  const numero = p.registration ? ` ou a matrícula ${p.registration}` : "";
  return (
    `Ela entra pela tela de login, não pelo "Primeiro acesso": escolhe a filial onde trabalha ` +
    `(ou Externo, se não tem filial), digita o login ${p.login}${numero} e esta senha. ` +
    `Na entrada, o portal pede a senha nova.`
  );
}
