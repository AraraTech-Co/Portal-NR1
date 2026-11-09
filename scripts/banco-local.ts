/**
 * O seed de teste só grava em banco local.
 *
 * Ele cria contas `teste.*`, inclusive um master, com senha conhecida. Fora
 * de um banco local isso abriria contas com senha pública, então o seed para
 * antes de qualquer gravação quando o host do `DATABASE_URL` não é
 * localhost, 127.0.0.1 ou ::1. A mensagem não mostra a URL (ela traz senha).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

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

export function bancoLocal(url: string | undefined): boolean {
  const host = hostDoBanco(url);
  return host !== null && HOSTS_LOCAIS.has(host);
}

/** Para o processo (código 1) se o banco não for local. Nada é gravado antes. */
export function exigirBancoLocal(url: string | undefined = enderecoDoBanco()): void {
  if (bancoLocal(url)) return;
  console.error(
    "Seed de teste recusado: ele só roda em banco local (localhost, 127.0.0.1 ou ::1). Nada foi gravado.",
  );
  process.exit(1);
}
