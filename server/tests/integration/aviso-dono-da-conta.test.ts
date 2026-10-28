import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { avisoDoPapel, ORG_ROLE_LABEL } from "../../../client/src/lib/labels";

/**
 * Escolher "Dono da conta" avisa do acesso total.
 *
 * O aviso ficava no seletor do papel na conta, que saiu quando o papel
 * virou um só: no link de convite, na aprovação do pedido e em Mudar papel,
 * escolher o acesso total passou a não avisar nada. [CB-52]
 */
const PAGINAS = join(__dirname, "..", "..", "..", "client", "src", "pages");

function semComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const tela = (arquivo: string) =>
  semComentarios(readFileSync(join(PAGINAS, arquivo), "utf8")).replace(/\s+/g, " ");

describe("o aviso do papel [CB-52]", () => {
  it("Dono da conta e Master avisam do acesso total", () => {
    expect(avisoDoPapel("OWNER")).toMatch(/acesso total/);
    expect(avisoDoPapel("OWNER")).toMatch(/pessoas, papéis e convites/);
    expect(avisoDoPapel("MASTER")).toMatch(/acesso total a todas as contas/);
  });

  it("os outros papéis não avisam", () => {
    for (const papel of Object.keys(ORG_ROLE_LABEL).filter((p) => p !== "OWNER" && p !== "MASTER")) {
      expect(avisoDoPapel(papel), papel).toBeNull();
    }
    expect(avisoDoPapel(undefined)).toBeNull();
    expect(avisoDoPapel(null)).toBeNull();
  });
});

describe("onde o aviso aparece [CB-52]", () => {
  const conta = tela("AccountPage.tsx");
  const pessoas = tela("PessoasEAcessos.tsx");

  it("no link de convite com papel fixo, dizendo que vale para todos do link", () => {
    expect(conta).toContain(
      '{avisoDoPapel(fixedOrgRole) && ( <p className="form-hint is-warning" role="note"> {avisoDoPapel(fixedOrgRole)} Todos que usarem este link entram com ele. </p> )}',
    );
  });

  it("na aprovação do pedido de entrada", () => {
    expect(conta).toContain(
      '{avisoDoPapel(decideRoles[r.id]?.org_role) && ( <span className="form-hint is-warning" role="note"> {avisoDoPapel(decideRoles[r.id]?.org_role)} </span> )}',
    );
  });

  it("em Mudar papel, quando o papel muda para um de acesso total", () => {
    expect(pessoas).toContain(
      '{avisoDoPapel(editing.org_role) && editing.org_role !== p.org_role && ( <p className="form-hint is-warning" role="note"> {avisoDoPapel(editing.org_role)} </p> )}',
    );
  });
});
