import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { carregarOUltimo } from "../../../client/src/lib/ultimo-pedido";

/**
 * O painel da fiscalização mostra só a resposta do último filtro escolhido.
 *
 * Trocar de filial depressa disparava dois pedidos; se o da filial anterior
 * voltava por último, o painel mostrava o nome e o CNPJ dela com a outra
 * escolhida no filtro.
 */
function adiado<T>() {
  let resolver!: (v: T) => void;
  let rejeitar!: (e: unknown) => void;
  const promessa = new Promise<T>((res, rej) => {
    resolver = res;
    rejeitar = rej;
  });
  return { promessa, resolver, rejeitar };
}

function montar() {
  const pedidos = new Map<string, ReturnType<typeof adiado<string>>>();
  const tela = { dados: [] as string[], erros: [] as unknown[], fins: 0 };
  const carregar = carregarOUltimo(
    (filial: string) => {
      const p = adiado<string>();
      pedidos.set(filial, p);
      return p.promessa;
    },
    {
      ok: (v) => tela.dados.push(v),
      erro: (e) => tela.erros.push(e),
      fim: () => tela.fins++,
    },
  );
  return { pedidos, tela, carregar };
}

describe("só a resposta do último pedido vale", () => {
  it("a filial anterior volta depois: não aparece", async () => {
    const { pedidos, tela, carregar } = montar();
    const a = carregar("Loja");
    const b = carregar("AG");
    pedidos.get("AG")!.resolver("painel da AG");
    await b;
    pedidos.get("Loja")!.resolver("painel da Loja");
    await a;
    expect(tela.dados).toEqual(["painel da AG"]);
    expect(tela.fins).toBe(1);
  });

  it("o erro do pedido anterior não aparece", async () => {
    const { pedidos, tela, carregar } = montar();
    const a = carregar("Loja");
    const b = carregar("AG");
    pedidos.get("Loja")!.rejeitar(new Error("caiu"));
    await a;
    pedidos.get("AG")!.resolver("painel da AG");
    await b;
    expect(tela.erros).toEqual([]);
    expect(tela.dados).toEqual(["painel da AG"]);
  });

  it("em ordem, cada um aparece", async () => {
    const { pedidos, tela, carregar } = montar();
    const a = carregar("Loja");
    pedidos.get("Loja")!.resolver("painel da Loja");
    await a;
    const b = carregar("AG");
    pedidos.get("AG")!.rejeitar(new Error("caiu"));
    await b;
    expect(tela.dados).toEqual(["painel da Loja"]);
    expect(tela.erros).toHaveLength(1);
    expect(tela.fins).toBe(2);
  });

  it("o painel da fiscalização carrega por aqui", () => {
    const fonte = readFileSync(
      path.resolve(__dirname, "../../../client/src/pages/InspectionPage.tsx"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(fonte.match(/carregarOUltimo\(/g)?.length).toBe(1);
    expect(fonte).not.toMatch(/setData\(await fetchInspection/);
  });
});
