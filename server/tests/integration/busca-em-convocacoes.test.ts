import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { filtrarPessoas } from "../../../client/src/lib/busca-de-pessoas";

/**
 * Em Convocações, escolher quem convocar tem busca.
 *
 * As pessoas apareciam numa lista de marcar, sem busca; na turma de
 * treinamento havia "Buscar por nome, matrícula ou função". As duas passam
 * a usar a mesma busca. [B3-3-E]
 */
const CLIENTE = join(__dirname, "..", "..", "..", "client", "src");

function semComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const fonte = (...c: string[]) =>
  semComentarios(readFileSync(join(CLIENTE, ...c), "utf8")).replace(/\s+/g, " ");

const PESSOAS = [
  { id: "1", name: "João Araújo", registration: "19", jobRoleName: "Operador de Torno CNC" },
  { id: "2", name: "Carlos Pereira", registration: "24", jobRoleName: "Membro da CIPA" },
  { id: "3", name: "Lúcia Ramos", registration: null, jobRoleName: null },
];
const ids = (r: Array<{ id: string }>) => r.map((p) => p.id);

describe("a busca de pessoas [B3-3-E]", () => {
  it("acha pelo nome, sem acento e sem diferença de maiúscula", () => {
    expect(ids(filtrarPessoas(PESSOAS, "joao"))).toEqual(["1"]);
    expect(ids(filtrarPessoas(PESSOAS, "LUCIA"))).toEqual(["3"]);
  });

  it("acha pela matrícula e pela função", () => {
    expect(ids(filtrarPessoas(PESSOAS, "24"))).toEqual(["2"]);
    expect(ids(filtrarPessoas(PESSOAS, "cipa"))).toEqual(["2"]);
    expect(ids(filtrarPessoas(PESSOAS, "torno"))).toEqual(["1"]);
  });

  it("sem termo, ou só espaço, mostra todo mundo; termo sem ninguém, nada", () => {
    expect(ids(filtrarPessoas(PESSOAS, ""))).toEqual(["1", "2", "3"]);
    expect(ids(filtrarPessoas(PESSOAS, "   "))).toEqual(["1", "2", "3"]);
    expect(ids(filtrarPessoas(PESSOAS, " carlos "))).toEqual(["2"]);
    expect(filtrarPessoas(PESSOAS, "zzz")).toEqual([]);
  });
});

describe("Convocações e a turma usam a mesma escolha [B3-3-E]", () => {
  const picker = fonte("components", "PeoplePicker.tsx");
  const multi = picker.slice(picker.indexOf("function MultiPeoplePicker"));

  it("a escolha de várias pessoas tem a busca e diz quantas estão marcadas", () => {
    expect(multi).toContain("const filtrados = useMemo(() => filtrarPessoas(members, busca), [members, busca]);");
    expect(multi).toContain('placeholder="Buscar por nome, matrícula ou função"');
    expect(multi).toContain("{filtrados.map((m) => (");
    expect(multi).not.toContain("{members.map((m) => (");
    expect(multi).toMatch(/`\$\{value\.length\} pessoas marcadas`/);
  });

  it("marcar com a busca ativa não desmarca quem ficou fora do filtro", () => {
    expect(multi).toContain("const next = selected.has(id) ? value.filter((x) => x !== id) : [...value, id];");
    expect(multi).toContain("const picked = members.filter((m) => next.includes(m.id));");
  });

  it("Convocações usa a escolha de várias pessoas", () => {
    expect(fonte("pages", "SummonsPage.tsx")).toMatch(/<PeoplePicker mode="multiple"/);
  });

  it("a turma de treinamento usa a mesma busca, nas duas listas", () => {
    const turma = fonte("pages", "TrainingSessions.tsx");
    expect(turma.match(/filtrarPessoas\(membros, busca\)/g)?.length).toBe(2);
    expect(turma).not.toMatch(/function semAcento/);
  });
});
