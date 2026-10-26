import { describe, expect, it } from "vitest";
import {
  CABECALHO_OFICIAL,
  lerLinhas,
  type FuncaoDaEmpresa,
} from "../../../client/src/lib/planilha";

/**
 * A leitura da planilha de cadastro em massa.
 *
 * A coluna "empresa contratada", nome que a própria tela usava, não era
 * reconhecida — só "empresa" — e coluna desconhecida era deixada de lado sem
 * aviso: a empresa montava a planilha seguindo a tela e os terceirizados
 * entravam sem a empresa responsável, sem ninguém perceber. [B3-1-B] [S1-R]
 * A prévia também numerava as linhas sem contar o cabeçalho, diferente do
 * Excel [S1-G].
 */
const FUNCOES: FuncaoDaEmpresa[] = [
  { id: "f-torneiro", name: "Torneiro", establishment: { name: "Matriz" } },
  { id: "f-ajudante", name: "Ajudante", establishment: { name: "Matriz" } },
];
const EMPRESAS = [{ id: "c-limpeza", name: "Limpeza Industrial Ltda" }];
const ROTULOS = {
  papeis: { COLABORADOR: "Colaborador", SUPERVISOR: "Supervisor" },
  vinculos: { EMPLOYEE: "Empregado", CONTRACTOR: "Terceirizado" },
};

const ler = (texto: string) => lerLinhas(texto, FUNCOES, EMPRESAS, ROTULOS);

describe('a coluna "empresa contratada" é reconhecida [B3-1-B]', () => {
  it("o terceirizado entra ligado à empresa, com o cabeçalho que a tela mostra", () => {
    const { rows, problems } = ler(
      "nome;vinculo;empresa contratada\nLúcia Ramos;Terceirizado;Limpeza Industrial Ltda",
    );
    expect(problems).toEqual([]);
    expect(rows[0]!.contractor_id, "é o defeito do achado").toBe("c-limpeza");
    expect(rows[0]!.bond).toBe("CONTRACTOR");
  });

  it('o nome antigo "empresa" continua valendo', () => {
    const { rows } = ler(
      "nome;vinculo;empresa\nLúcia Ramos;Terceirizado;Limpeza Industrial Ltda",
    );
    expect(rows[0]!.contractor_id).toBe("c-limpeza");
  });

  it("terceirizado sem empresa é avisado na prévia, em vez de entrar calado", () => {
    const { rows, problems } = ler("nome;vinculo\nLúcia Ramos;Terceirizado");
    expect(rows.length, "a linha ainda entra").toBe(1);
    expect(problems.join(" ")).toContain("sem empresa contratada");
  });
});

describe("coluna que o portal não conhece é avisada [B3-1-B]", () => {
  it("o aviso diz qual coluna e quais o portal lê", () => {
    const { problems } = ler("nome;setor;turno\nMaria;Produção;Noite");
    const aviso = problems.find((p) => p.includes("não reconhecida"));
    expect(aviso, "a coluna estranha é avisada").toBeTruthy();
    expect(aviso).toContain('"setor"');
    expect(aviso).toContain('"turno"');
    expect(aviso, "e diz o que vale").toContain("empresa contratada");
  });

  it("planilha com os cabeçalhos do modelo não gera aviso de coluna", () => {
    const { problems } = ler(
      `${CABECALHO_OFICIAL.join(";")}\nMaria de Souza;1023;;;Torneiro;Matriz;10/03/2025;Empregado;;Colaborador`,
    );
    expect(problems.filter((p) => p.includes("não reconhecida"))).toEqual([]);
  });
});

describe("a linha é numerada como no Excel [S1-G]", () => {
  it("com cabeçalho, a primeira pessoa é a linha 2", () => {
    const { problems } = ler("nome;funcao\nMaria;Inexistente");
    expect(problems[0], "antes dizia Linha 1").toContain("Linha 2");
  });

  it("sem cabeçalho, a primeira pessoa é a linha 1", () => {
    const { problems } = ler("Maria;;;;Inexistente");
    expect(problems[0]).toContain("Linha 1");
  });
});

describe("o que já era guardado continua [B2-1-L] [CB-6]", () => {
  it("linha inteira caída no nome é recusada", () => {
    const { problems } = ler(
      "nome;matricula\nMaria de Souza 529.982.247-25 10/03/2025;1023",
    );
    expect(problems.join(" ")).toContain("não parece um nome");
  });

  it("função que não existe é avisada e a pessoa entra sem função", () => {
    const { rows, problems } = ler("nome;funcao\nMaria;Soldador");
    expect(problems.join(" ")).toContain('função "Soldador" não existe');
    expect(rows[0]!.job_role_id).toBeUndefined();
  });

  it("o papel chega por nome e sai como código", () => {
    const { rows } = ler("nome;papel\nMaria;Supervisor");
    expect(rows[0]!.org_role).toBe("SUPERVISOR");
  });
});
