import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { comoEntrarComSenhaProvisoria } from "../../../client/src/lib/senha-provisoria";

/** O aviso que acompanha a senha provisória em Conta e usuários. */
describe("como entrar com a senha provisória", () => {
  it("com matrícula: o login ou a matrícula, pela tela de login", () => {
    expect(comoEntrarComSenhaProvisoria({ login: "ana.souza", registration: "000061" })).toBe(
      'Ela entra pela tela de login, não pelo "Primeiro acesso": escolhe a filial onde trabalha ' +
        "(ou Externo, se não tem filial), digita o login ana.souza ou a matrícula 000061 e esta senha. " +
        "Na entrada, o portal pede a senha nova.",
    );
  });

  it("sem matrícula: só o login", () => {
    const aviso = comoEntrarComSenhaProvisoria({ login: "ana.souza", registration: null });
    expect(aviso).toContain("digita o login ana.souza e esta senha.");
    expect(aviso).not.toContain("matrícula");
  });

  it("a tela mostra o aviso junto com a senha", () => {
    const tela = readFileSync(join(__dirname, "../../../client/src/pages/PessoasEAcessos.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(tela).toMatch(/comoEntrar: comoEntrarComSenhaProvisoria\(p\),/);
    expect(tela).toMatch(/<code>\{reset\.password\}<\/code>/);
    expect(tela).toMatch(/<p>\{reset\.comoEntrar\}<\/p>/);
  });
});
