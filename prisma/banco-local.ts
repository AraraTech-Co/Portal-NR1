/**
 * Seed com senha conhecida só grava em banco local.
 *
 * O seed de teste (`scripts/seed-teste-org.ts`) cria contas `teste.*`,
 * inclusive um master, com senha conhecida; o seed principal
 * (`prisma/seed.ts`), sem SEED_ADMIN_PASSWORD, grava a senha conhecida dos
 * testes no `master` e no `admin`. Os dois param antes de qualquer gravação
 * quando o banco não é localhost, 127.0.0.1 ou ::1. A mensagem não mostra a
 * URL (ela traz senha).
 *
 * Fica em `prisma/` porque a imagem de produção leva esta pasta, e o seed
 * principal roda de dentro dela.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Parâmetros da URL que trocam o servidor de destino no lugar do host. */
const PARAMETROS_DE_HOST = new Set(["host", "hostaddr"]);

/**
 * O endereço que o Prisma vai usar: o da variável de ambiente, ou, sem ela,
 * o do `.env` da raiz do projeto (a variável vence, como no Prisma).
 */
export function enderecoDoBanco(
  env: NodeJS.ProcessEnv = process.env,
  arquivo = join(__dirname, "..", ".env"),
): string | undefined {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  try {
    const linha = readFileSync(arquivo, "utf8")
      .split(/\r?\n/)
      .find((l) => /^\s*DATABASE_URL\s*=/.test(l));
    if (!linha) return undefined;
    return linha.replace(/^\s*DATABASE_URL\s*=\s*/, "").trim().replace(/^(["'])(.*)\1$/, "$2");
  } catch {
    return undefined;
  }
}

/** O host do endereço do banco, ou nulo se o endereço não puder ser lido. */
export function hostDoBanco(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Local só quando o host da URL é local e nenhum parâmetro da URL indica
 * outro servidor: o Prisma usa o parâmetro `host` no lugar do host da URL.
 */
export function bancoLocal(url: string | undefined): boolean {
  const host = hostDoBanco(url);
  if (host === null || !HOSTS_LOCAIS.has(host)) return false;
  const parametros = [...new URL(url as string).searchParams.keys()];
  return !parametros.some((p) => PARAMETROS_DE_HOST.has(p.toLowerCase()));
}

/** Para o processo (código 1) se o banco não for local. Nada é gravado antes. */
export function exigirBancoLocal(
  url: string | undefined = enderecoDoBanco(),
  quem = "Seed de teste",
): void {
  if (bancoLocal(url)) return;
  console.error(
    `${quem} recusado: ele só roda em banco local (localhost, 127.0.0.1 ou ::1, sem parâmetro host na URL). Nada foi gravado.`,
  );
  process.exit(1);
}
