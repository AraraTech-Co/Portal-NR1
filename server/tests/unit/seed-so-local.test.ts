import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { bancoLocal, enderecoDoBanco, hostDoBanco } from "../../../scripts/banco-local";

/**
 * O seed de teste só grava em banco local: ele cria contas com senha
 * conhecida, inclusive um master.
 */
const RAIZ = join(__dirname, "..", "..", "..");

describe("o seed de teste só roda em banco local", () => {
  it("aceita localhost, 127.0.0.1 e ::1", () => {
    for (const url of [
      "postgresql://u:p@localhost:5432/x",
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
