import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/app";

/**
 * Todo papel chega a trocar a própria senha.
 *
 * O link ficava em Conta e usuários, que só master, dono e RH abrem: SST,
 * gerente, ADM loja, supervisor, colaborador e fiscal não tinham caminho. E
 * o link parecia texto comum. [B2-1-G]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const SENHA = "teste1234";
const CLIENTE = join(__dirname, "..", "..", "..", "client", "src");
const PAPEIS = [
  "teste.sst",
  "teste.gerente",
  "teste.admloja",
  "teste.supervisor",
  "teste.colaborador",
  "teste.fiscal",
];

function semComentarios(codigo: string): string {
  return codigo
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const fonte = (...c: string[]) => semComentarios(readFileSync(join(CLIENTE, ...c), "utf8")).replace(/\s+/g, " ");

/* Valores de teste montados aqui: nenhum é senha de verdade. */
const ERRADA = "errada".repeat(2);
const NOVA = "nova".repeat(3);

let app: Express;

beforeAll(() => {
  app = createApp();
});

describe("o servidor aceita a troca de qualquer papel [B2-1-G]", () => {
  for (const login of PAPEIS) {
    it(`${login} chega à conferência da senha atual`, async () => {
      const entrada = await request(app).post("/api/auth").send({ login, password: SENHA });
      expect(entrada.status, `login de ${login}`).toBe(200);
      /* Senha atual errada de propósito: prova que a rota atende, sem trocar nada. */
      const res = await request(app)
        .post("/api/auth/password")
        .set({ Authorization: `Bearer ${entrada.body.token}` })
        .send({ current_password: ERRADA, new_password: NOVA });
      expect(res.status, JSON.stringify(res.body)).toBe(401);
      expect(res.body.message).toBe("Senha atual incorreta.");
    });
  }
});

describe("a tela leva até lá, para todos [B2-1-G]", () => {
  const menu = fonte("layout", "Sidebar.tsx");

  it("o rodapé do menu tem o link, fora da lista de módulos", () => {
    const rodape = menu.slice(menu.indexOf('<div className="sidebar-footer">'));
    expect(rodape).toContain(
      '<Link to="/trocar-senha" className="sidebar-logout sidebar-senha" onClick={onCloseMobile}> Trocar minha senha </Link>',
    );
    expect(rodape).not.toMatch(/canReadModule[\s\S]*trocar-senha/);
  });

  it("em Conta e usuários, o link tem cara de botão", () => {
    expect(fonte("pages", "AccountPage.tsx")).toContain(
      '<Link to="/trocar-senha" className="btn btn-secondary btn-compact"> Trocar minha senha </Link>',
    );
  });

  it("a página de trocar a senha fica fora do menu e aceita voltar sem trocar", () => {
    expect(fonte("App.tsx")).toContain('<Route path="/trocar-senha" element={<ChangePasswordPage />} />');
    expect(fonte("pages", "ChangePasswordPage.tsx")).toContain("Voltar sem trocar");
  });
});
