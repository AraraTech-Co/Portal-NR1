import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A tela de Documentos do RH: publicar para pessoa, filial ou empresa, dar
 * ciência e o campo de arquivo limpo depois de publicar (desenho de 13/11,
 * item 10). Lida sem os comentários.
 */
const semComentarios = (codigo: string) =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const tela = semComentarios(
  readFileSync(join(__dirname, "../../../client/src/pages/HrDocumentsPage.tsx"), "utf8"),
);

describe("Documentos do RH na tela", () => {
  it("o formulário aparece só para quem escreve no módulo", () => {
    expect(tela).toMatch(/before=\{canWrite \? <PublicarDocumento onPublished=\{reload\} \/> : undefined\}/);
  });

  it("'Todas as filiais' e 'Uma pessoa' só para RH, Master e Dono; o ADM loja vê só as filiais que gere", () => {
    expect(tela).toMatch(/\{centralDoPessoal && <option value="empresa">Todas as filiais<\/option>\}/);
    expect(tela).toMatch(/\{centralDoPessoal && <option value="pessoa">Uma pessoa<\/option>\}/);
    expect(tela).toMatch(/\.filter\(\(e\) => centralDoPessoal \|\| gere\.has\(e\.id\)\)/);
  });

  it("filial e pessoa vão em campos separados, nunca os dois", () => {
    expect(tela).toMatch(/\.\.\.\(destino === "filial" \? \{ establishment_id: filial \} : \{\}\)/);
    expect(tela).toMatch(/\.\.\.\(destino === "pessoa" \? \{ target_user_id: pessoa \} : \{\}\)/);
  });

  it("o botão de ciência segue o servidor (can_ack), e o arquivo é limpo depois de publicar", () => {
    expect(tela).toMatch(/\) : r\.can_ack \? \(/);
    expect(tela).toMatch(/key=\{campoDoArquivo\}/);
    expect(tela).toMatch(/setCampoDoArquivo\(\(n\) => n \+ 1\)/);
  });

  it("o destino diz a filial", () => {
    expect(tela).toMatch(/if \(r\.establishment\) return `Filial \$\{r\.establishment\.name\}`;/);
  });
});
