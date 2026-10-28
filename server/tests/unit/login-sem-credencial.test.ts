import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { senhaInicial } from "../../../prisma/senha-inicial";

/**
 * Nenhuma credencial vem escrita na tela de entrada nem fixa em produção.
 *
 * A tela de login abre com os campos vazios, e o seed só cria o `admin` e o
 * `master` em produção com uma senha definida na hora (SEED_ADMIN_PASSWORD),
 * que a pessoa troca no primeiro acesso.
 */

const semComentarios = (codigo: string) =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("tela de entrada sem credencial", () => {
  const tela = semComentarios(
    readFileSync(join(__dirname, "../../../client/src/pages/LoginPage.tsx"), "utf8"),
  );

  it("usuário e senha começam vazios", () => {
    expect(tela).toMatch(/const \[loginId, setLoginId\] = useState\(""\);/);
    expect(tela).toMatch(/const \[password, setPassword\] = useState\(""\);/);
  });

  it("nenhum usuário ou senha do seed aparece na tela", () => {
    expect(tela).not.toMatch(/admin123|"admin"|"master"/);
  });
});

describe("senha inicial do seed", () => {
  const forte = "s".repeat(8) + "-" + "9".repeat(8);

  it("fora de produção, sem variável, continua a senha dos testes", () => {
    expect(senhaInicial({ NODE_ENV: "test" })).toEqual({ senha: "admin123", definida: false });
  });

  it("em produção, sem variável, o seed não roda", () => {
    expect(() => senhaInicial({ NODE_ENV: "production" })).toThrow(/SEED_ADMIN_PASSWORD/);
    expect(() => senhaInicial({ NODE_ENV: "production", SEED_ADMIN_PASSWORD: "   " })).toThrow(
      /SEED_ADMIN_PASSWORD/,
    );
  });

  it("com a variável, usa a senha dada e manda trocar no primeiro acesso", () => {
    expect(senhaInicial({ NODE_ENV: "production", SEED_ADMIN_PASSWORD: forte })).toEqual({
      senha: forte,
      definida: true,
    });
  });

  it("tira espaço e quebra de linha em volta da senha dada", () => {
    expect(senhaInicial({ SEED_ADMIN_PASSWORD: ` ${forte}\n` }).senha).toBe(forte);
  });

  it("recusa senha inicial curta", () => {
    expect(() =>
      senhaInicial({ NODE_ENV: "production", SEED_ADMIN_PASSWORD: "s".repeat(11) }),
    ).toThrow(/12 caracteres/);
  });
});
