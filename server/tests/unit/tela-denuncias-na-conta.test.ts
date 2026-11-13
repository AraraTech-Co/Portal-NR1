import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * O canal de denúncia na conta (desenho de 13/11, item 11): o quadro das
 * próprias identificadas só dentro do portal, e a resposta e a ciência pela
 * conta quando a denúncia foi aberta por ali. Lida sem os comentários.
 */
const semComentarios = (codigo: string) =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const tela = semComentarios(
  readFileSync(join(__dirname, "../../../client/src/pages/EthicsReportPage.tsx"), "utf8"),
);

describe("as minhas denúncias na tela", () => {
  it("só com login, dentro do portal — nunca no canal público", () => {
    expect(tela).toMatch(/const naConta = Boolean\(user\) && !publico && !semEmpresa;/);
    expect(tela).toMatch(/\{naConta && minhas\.length > 0 && \(/);
  });

  it("o aviso com ?minha abre o acompanhamento e a denúncia", () => {
    expect(tela).toMatch(/searchParams\.has\("minha"\) \? "track" : "new"\);/);
    expect(tela).toMatch(/if \(naConta && pedida\) void abrirMinha\(pedida\);/);
  });

  it("aberta pela conta, a resposta e a ciência vão pela conta; pelo protocolo, como antes", () => {
    expect(tela).toMatch(/if \(minhaAberta\) \{\s*await sendMyEthicsMessage\(minhaAberta, answer\.trim\(\)\);/);
    expect(tela).toMatch(/if \(minhaAberta\) \{\s*await acknowledgeMyEthicsReport\(minhaAberta,/);
    expect(tela).toMatch(/setTracked\(null\);\s*setMinhaAberta\(null\);/);
  });
});
