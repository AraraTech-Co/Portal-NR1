import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import moduleAccess from "../../config/module-access.json";

/**
 * Quem só lê não recebe a instrução de quem cadastra.
 *
 * Em Emergências, com a lista vazia, o colaborador lia "Cadastre os cenários
 * de emergência…". Ocorrências mostrava o formulário de registrar a quem só
 * consulta, e o servidor recusava o envio. Terceiros dava a mesma instrução
 * a quem só lê. [S1-E]
 */
const PAGINAS = join(__dirname, "..", "..", "..", "client", "src", "pages");

function semComentarios(codigo: string): string {
  return codigo
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const tela = (arquivo: string) => semComentarios(readFileSync(join(PAGINAS, arquivo), "utf8")).replace(/\s+/g, " ");
const acesso = moduleAccess as Record<string, Record<string, string>>;

describe("há quem só leia nestes módulos [S1-E]", () => {
  it("o colaborador lê Emergências; o fiscal lê Ocorrências e Terceiros", () => {
    expect(acesso.colaborador.emergencias).toBe("read");
    expect(acesso.fiscal.ocorrencias).toBe("read");
    expect(acesso.fiscal.terceiros).toBe("read");
  });
});

describe("a tela fala com quem só lê [S1-E]", () => {
  it("Emergências vazia: quem só lê não recebe a instrução de cadastrar", () => {
    const t = tela("EmergenciesPage.tsx");
    expect(t).toContain('const { canWrite } = useModuleAccess("emergencias");');
    expect(t).toMatch(
      /description=\{ canWrite \? "Cadastre os cenários de emergência[^"]*" : "A empresa ainda não cadastrou procedimentos de emergência\. Quando cadastrar, eles aparecem aqui\." \}/,
    );
  });

  it("Ocorrências: o formulário só aparece para quem registra, e o vazio não manda usá-lo", () => {
    const t = tela("OccurrencesPage.tsx");
    expect(t).toContain('const { canWrite } = useModuleAccess("ocorrencias");');
    expect(t).toContain('{canWrite && ( <section className="form-section"> <h2>Registrar ocorrência</h2>');
    expect(t).toMatch(/description=\{ canWrite \? "Use o formulário acima para registrar a primeira\." : "Nenhuma ocorrência registrada com este filtro\." \}/);
    expect(t).toMatch(/description=\{ canWrite \? "Registre o que aconteceu[^"]*" : "O que aconteceu na empresa, com a análise de cada ocorrência\." \}/);
  });

  it("Terceiros vazio: quem só lê não recebe a instrução de cadastrar", () => {
    const t = tela("ContractorsPage.tsx");
    expect(t).toMatch(/description=\{ canWrite \? "Cadastre as empresas contratadas[^"]*" : "Nenhuma empresa contratada cadastrada\." \}/);
  });
});
