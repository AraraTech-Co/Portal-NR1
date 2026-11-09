import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { bancoLocal, enderecoDoBanco, hostDoBanco } from "../../../prisma/banco-local";

/**
 * Seed com senha conhecida só grava em banco local: o seed de teste cria
 * contas com senha conhecida, inclusive um master; o seed principal, sem
 * SEED_ADMIN_PASSWORD, grava a senha dos testes no `master` e no `admin`.
 */
const RAIZ = join(__dirname, "..", "..", "..");

describe("o seed de teste só roda em banco local", () => {
  it("aceita localhost, 127.0.0.1 e ::1", () => {
    for (const url of [
      "postgresql://u:p@localhost:5432/x",
      "postgresql://u:p@localhost:5432/x?schema=public",
      "postgresql://u:p@127.0.0.1:5432/x",
      "postgresql://u:p@[::1]:5432/x",
      "postgresql://u:p@LOCALHOST:5432/x",
    ]) {
      expect(bancoLocal(url), url).toBe(true);
    }
  });

  it("recusa qualquer outro host, endereço vazio ou ilegível", () => {
    for (const url of [
      "postgresql://u:p@db.exemplo.com:5432/x",
      "postgresql://u:p@10.0.0.5:5432/x",
      "postgresql://u:p@localhost.exemplo.com:5432/x",
      "postgresql://u:p@127.0.0.2:5432/x",
      // O Prisma usa o parâmetro host no lugar do host da URL.
      "postgresql://u:p@localhost:5432/x?host=db.exemplo.com",
      "postgresql://u:p@localhost:5432/x?schema=public&host=localhost",
      "postgresql://u:p@127.0.0.1:5432/x?HOST=db.exemplo.com",
      "postgresql://u:p@localhost:5432/x?hostaddr=10.0.0.5",
      "nao-e-url",
      "",
      undefined,
    ]) {
      expect(bancoLocal(url), String(url)).toBe(false);
    }
    expect(hostDoBanco("postgresql://u:p@db.exemplo.com:5432/x")).toBe("db.exemplo.com");
  });

  it("sem a variável, lê o DATABASE_URL do .env, e a variável vence o arquivo", () => {
    const pasta = mkdtempSync(join(tmpdir(), "seed-env-"));
    const arquivo = join(pasta, ".env");
    writeFileSync(arquivo, 'OUTRA=1\nDATABASE_URL="postgresql://u:p@localhost:5432/x"\n');
    expect(enderecoDoBanco({}, arquivo)).toBe("postgresql://u:p@localhost:5432/x");
    expect(enderecoDoBanco({ DATABASE_URL: "postgresql://u:p@db.exemplo.com/x" }, arquivo)).toBe(
      "postgresql://u:p@db.exemplo.com/x",
    );
    expect(enderecoDoBanco({}, join(pasta, "nao-existe"))).toBeUndefined();
  });

  it("rodado com host externo, para com código 1 antes de conectar, sem mostrar a URL", () => {
    const url = "postgresql://usuario:senha-secreta@db.exemplo.invalid:5432/portal";
    const r = spawnSync("npx", ["tsx", "scripts/seed-teste-org.ts"], {
      cwd: RAIZ,
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toContain("Seed de teste recusado");
    const saida = `${r.stdout}\n${r.stderr}`;
    expect(saida).not.toContain("senha-secreta");
    expect(saida).not.toContain("db.exemplo.invalid");
  });
});

/** Roda um seed com host externo e devolve código e saída. */
function rodar(script: string, env: Record<string, string | undefined>) {
  const base = { ...process.env };
  delete base.SEED_ADMIN_PASSWORD;
  return spawnSync("npx", ["tsx", script], {
    cwd: RAIZ,
    env: { ...base, ...env },
    encoding: "utf8",
    timeout: 60_000,
  });
}

describe("o seed principal, sem SEED_ADMIN_PASSWORD, só roda em banco local", () => {
  const url = "postgresql://usuario:senha-secreta@db.exemplo.invalid:5432/portal";

  it("host externo sem a variável: código 1 antes de conectar, sem mostrar a URL", () => {
    for (const [nome, endereco] of [
      ["host externo", url],
      ["parâmetro host", "postgresql://usuario:senha-secreta@localhost:5432/portal?host=db.exemplo.invalid"],
    ]) {
      const r = rodar("prisma/seed.ts", { DATABASE_URL: endereco, SEED_ADMIN_PASSWORD: undefined });
      expect(r.status, `${nome}: ${r.stderr}`).toBe(1);
      expect(r.stderr, nome).toContain("Seed sem SEED_ADMIN_PASSWORD recusado");
      const saida = `${r.stdout}\n${r.stderr}`;
      expect(saida, nome).not.toContain("senha-secreta");
      expect(saida, nome).not.toContain("db.exemplo.invalid");
      // Parou antes do Prisma: nenhum erro de conexão.
      expect(saida, nome).not.toMatch(/P1001|Can't reach database/);
    }
  });

  it("com a variável definida, a trava não se aplica: chega a tentar conectar", () => {
    const r = rodar("prisma/seed.ts", {
      DATABASE_URL: url,
      SEED_ADMIN_PASSWORD: ["senha", "inicial", "de", "teste"].join("-"),
    });
    expect(r.status).toBe(1);
    expect(r.stderr).not.toContain("recusado");
    expect(`${r.stdout}\n${r.stderr}`).toMatch(/P1001|Can't reach database/);
  });

  it("só espaço na variável conta como sem variável", () => {
    const r = rodar("prisma/seed.ts", { DATABASE_URL: url, SEED_ADMIN_PASSWORD: "   " });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Seed sem SEED_ADMIN_PASSWORD recusado");
  });
});
