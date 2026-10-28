import prisma from "../../src/model/prisma";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O seed rodado de verdade: em produção sem senha definida ele para antes de
 * gravar; com senha definida, não troca a senha de quem já existe.
 */

const raiz = join(__dirname, "../../..");

function rodarSeed(env: Record<string, string | undefined>) {
  const ambiente = { ...process.env, ...env };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete ambiente[k];
  return spawnSync(process.execPath, ["--import", "tsx", "prisma/seed.ts"], {
    cwd: raiz,
    env: ambiente,
    encoding: "utf8",
    timeout: 120_000,
  });
}

const doAdmin = () =>
  prisma.user.findUniqueOrThrow({
    where: { login: "admin" },
    select: { passwordHash: true, mustChangePassword: true, updatedAt: true },
  });

describe("seed sem senha fixa em produção", () => {
  it("em produção, sem SEED_ADMIN_PASSWORD, para sem gravar nada", async () => {
    const antes = await doAdmin();
    const r = rodarSeed({ NODE_ENV: "production", SEED_ADMIN_PASSWORD: undefined });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/SEED_ADMIN_PASSWORD/);
    expect(await doAdmin()).toEqual(antes);
  });

  it("com SEED_ADMIN_PASSWORD, quem já existe mantém a própria senha", async () => {
    const antes = await doAdmin();
    const r = rodarSeed({ SEED_ADMIN_PASSWORD: "s".repeat(8) + "-" + "9".repeat(8) });
    expect(r.status, r.stderr).toBe(0);
    const depois = await doAdmin();
    expect(depois.passwordHash).toBe(antes.passwordHash);
    expect(depois.mustChangePassword).toBe(antes.mustChangePassword);
    expect(r.stdout).not.toMatch(/admin123/);
  });
});
