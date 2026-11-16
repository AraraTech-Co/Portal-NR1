import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError } from "../../../client/src/api/client";
import { comAvisoDeEquivalente } from "../../../client/src/api/operation";

/**
 * A tela pergunta antes de criar ou renomear função equivalente (Correção 6,
 * C6-5): o servidor responde 409 "funcao_equivalente" e só aceita com a
 * confirmação.
 */
const equivalente = () =>
  new ApiError('Já existe "Repositor" no setor Frente. Criar mesmo assim?', 409, {
    message: 'Já existe "Repositor" no setor Frente. Criar mesmo assim?',
    code: "funcao_equivalente",
  });

describe("comAvisoDeEquivalente", () => {
  it("sem equivalente, faz uma vez, sem confirmação e sem perguntar", async () => {
    const chamadas: boolean[] = [];
    let perguntou = false;
    await comAvisoDeEquivalente(
      async (c) => void chamadas.push(c),
      "Nada foi criado.",
      () => ((perguntou = true), true),
    );
    expect(chamadas).toEqual([false]);
    expect(perguntou).toBe(false);
  });

  it("com equivalente, pergunta com a mensagem do servidor e, confirmado, refaz com a confirmação", async () => {
    const chamadas: boolean[] = [];
    const perguntas: string[] = [];
    await comAvisoDeEquivalente(
      async (c) => {
        chamadas.push(c);
        if (!c) throw equivalente();
      },
      "Nada foi criado.",
      (p) => (perguntas.push(p), true),
    );
    expect(perguntas).toEqual(['Já existe "Repositor" no setor Frente. Criar mesmo assim?']);
    expect(chamadas).toEqual([false, true]);
  });

  it("recusado, não refaz e avisa que nada mudou", async () => {
    const chamadas: boolean[] = [];
    await expect(
      comAvisoDeEquivalente(
        async (c) => {
          chamadas.push(c);
          throw equivalente();
        },
        "Nada foi criado.",
        () => false,
      ),
    ).rejects.toThrow("Nada foi criado.");
    expect(chamadas).toEqual([false]);
  });

  it("outro erro passa direto, sem perguntar", async () => {
    let perguntou = false;
    await expect(
      comAvisoDeEquivalente(
        async () => {
          throw new ApiError("Setor inválido.", 400, { message: "Setor inválido." });
        },
        "Nada foi criado.",
        () => ((perguntou = true), true),
      ),
    ).rejects.toThrow("Setor inválido.");
    expect(perguntou).toBe(false);
  });
});

describe("a tela de Operação usa o aviso no criar e no renomear", () => {
  const tela = readFileSync(join(__dirname, "../../../client/src/pages/OperationPage.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("Nova função", () => {
    expect(tela).toMatch(
      /comAvisoDeEquivalente\(\s*\(confirmar\) => createJobRole\(sectorId, name, confirmar\),\s*"Nada foi criado\.",\s*\)/,
    );
  });

  it("renomear", () => {
    expect(tela).toMatch(
      /comAvisoDeEquivalente\(\s*\(confirmar\) =>\s*updateJobRole\(j\.id, confirmar \? \{ name, confirmar_equivalente: true \} : \{ name \}\),\s*"O nome não foi trocado\.",\s*\)/,
    );
    expect(tela).not.toMatch(/await updateJobRole\(j\.id, \{ name \}\)/);
  });
});
