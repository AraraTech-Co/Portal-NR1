import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  avisoAoGravar,
  avisoAoValidar,
  painelDaAvaliacao,
  rotuloDeGravar,
  textoDaPrevia,
} from "../../../client/src/lib/avaliacao";

/**
 * Avaliar, validar e reavaliar deixam de se confundir.
 *
 * Quem validou não tinha certeza de que validou: a tela não dizia nada e
 * mostrava logo abaixo o formulário vazio com "Reavaliar". E quem
 * reavaliou viu "Nível pela matriz: Tolerável" e saiu achando que tinha
 * gravado. [B3-2-E]
 */
const PAGINAS = join(__dirname, "..", "..", "..", "client", "src", "pages");

function semComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const tela = (arquivo: string) =>
  semComentarios(readFileSync(join(PAGINAS, arquivo), "utf8")).replace(/\s+/g, " ");

const base = {
  podeEscrever: true,
  temMetodologia: true,
  temRascunho: false,
  temValidada: false,
  reavaliando: false,
};

describe("o que o painel mostra [B3-2-E]", () => {
  it("risco nunca avaliado: o formulário aparece direto", () => {
    expect(painelDaAvaliacao(base)).toEqual({ formulario: true, botaoReavaliar: false });
  });

  it("depois de validada: nada de formulário, só o botão de reavaliar", () => {
    expect(painelDaAvaliacao({ ...base, temValidada: true })).toEqual({
      formulario: false,
      botaoReavaliar: true,
    });
  });

  it("pediu para reavaliar: o formulário aparece, e o botão sai", () => {
    expect(painelDaAvaliacao({ ...base, temValidada: true, reavaliando: true })).toEqual({
      formulario: true,
      botaoReavaliar: false,
    });
  });

  it("com avaliação aguardando validação, nem formulário nem botão", () => {
    expect(painelDaAvaliacao({ ...base, temValidada: true, temRascunho: true })).toEqual({
      formulario: false,
      botaoReavaliar: false,
    });
  });

  it("quem só lê, ou sem metodologia, não vê nenhum dos dois", () => {
    const nada = { formulario: false, botaoReavaliar: false };
    expect(painelDaAvaliacao({ ...base, temValidada: true, podeEscrever: false })).toEqual(nada);
    expect(painelDaAvaliacao({ ...base, temMetodologia: false })).toEqual(nada);
  });
});

describe("o que o painel diz [B3-2-E]", () => {
  it("a prévia diz que ainda não gravou, e o que continua valendo", () => {
    const reavaliacao = textoDaPrevia("Substancial");
    expect(reavaliacao.antes).toMatch(/^Ainda não gravado\. Se gravar, a reavaliação fica com o nível$/);
    expect(reavaliacao.depois).toBe(" e aguarda validação; até lá, o risco continua Substancial.");

    const primeira = textoDaPrevia(null);
    expect(primeira.antes).toMatch(/^Ainda não gravado\. Se gravar, a avaliação fica/);
    expect(primeira.depois).toBe(" e aguarda validação.");
  });

  it("validar confirma, dizendo o nível que passa a valer", () => {
    expect(avisoAoValidar("Substancial")).toBe("Avaliação validada. O risco passa a valer Substancial.");
  });

  it("gravar confirma, dizendo que falta validar", () => {
    expect(avisoAoGravar(true)).toMatch(/^Reavaliação gravada\..*outra pessoa validar.*vale o nível validado/);
    expect(avisoAoGravar(false)).toMatch(/^Avaliação gravada\..*outra pessoa validar/);
  });

  it("o botão diz que grava", () => {
    expect(rotuloDeGravar(true, false)).toBe("Gravar reavaliação");
    expect(rotuloDeGravar(false, false)).toBe("Gravar avaliação");
    expect(rotuloDeGravar(true, true)).toBe("Gravando…");
  });
});

describe("a tela usa as regras [B3-2-E]", () => {
  const painel = tela("AssessRiskPanel.tsx");

  it("o formulário e o botão de reavaliar seguem o painelDaAvaliacao", () => {
    expect(painel).toContain("{painel.formulario && version && (");
    expect(painel).toContain("{painel.botaoReavaliar && (");
    expect(painel).toMatch(/onClick=\{\(\) => \{ setAviso\(null\); setReavaliando\(true\); \}\} > Fazer uma reavaliação/);
  });

  it("validar e gravar mostram a confirmação, como status", () => {
    expect(painel).toContain('<p className="assess-ok" role="status"> {aviso} </p>');
    expect(painel).toMatch(/await validateAssessment\(avaliacao\.id\); setAviso\(avisoAoValidar\(/);
    expect(painel).toMatch(/setReavaliando\(false\); setAviso\(avisoAoGravar\(eraReavaliacao\)\);/);
  });

  it("a prévia usa o texto de ainda não gravado, e o botão diz que grava", () => {
    expect(painel).toContain("{previa.antes}");
    expect(painel).toContain("{previa.depois}");
    expect(painel).not.toContain("Nível pela matriz");
    expect(painel).toContain("{rotuloDeGravar(validated != null, busy)}");
  });

  it("o botão que abre o painel não diz mais Reavaliar", () => {
    const perigo = tela("HazardFormPage.tsx");
    expect(perigo).toContain('{avaliando === r.id ? "Fechar" : level ? "Avaliação e medidas" : "Avaliar"}');
  });
});
