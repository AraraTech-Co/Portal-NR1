import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  CABECALHO_DA_FOLHA,
  dataDoExcel,
  lerLinhas,
  lerTabela,
  normalizarData,
  type FilialDaEmpresa,
  type FuncaoDaEmpresa,
} from "../../../client/src/lib/planilha";
import { PlanilhaIlegivel, gerarXlsx, lerXlsx } from "../../../client/src/lib/xlsx";
import { importarEmLotes } from "../../../client/src/lib/importar-em-lotes";

/**
 * A planilha de funcionários do sistema de folha, enviada como vem. [PF-1]
 *
 * As colunas são as da exportação real da Americana (10/2026), na mesma
 * ordem. As pessoas são inventadas; os CPFs são válidos pelo dígito.
 */

function cpf(base9: string): string {
  const d = base9.split("").map(Number);
  const dv = (n: number) => {
    const s = d.slice(0, n).reduce((t, x, i) => t + x * (n + 1 - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  d.push(dv(9));
  d.push(dv(10));
  return d.join("");
}

const LOJA: FilialDaEmpresa = { id: "e-loja", name: "Loja Americana", taxId: null, payrollCode: "0682" };
const AG: FilialDaEmpresa = { id: "e-ag", name: "Administrativo", taxId: null, payrollCode: "683" };
const SUPLEMENTO: FilialDaEmpresa = { id: "e-sup", name: "Suplemento", taxId: null, payrollCode: "0961" };
const FILIAIS = [LOJA, AG, SUPLEMENTO];
const FUNCOES: FuncaoDaEmpresa[] = [
  { id: "f-repositor", name: "REPOSITOR", establishment: { id: LOJA.id, name: LOJA.name } },
  { id: "f-repositora", name: "REPOSITORA", establishment: { id: LOJA.id, name: LOJA.name } },
  { id: "f-aux-adm", name: "AUXILIAR ADMINISTRATIVO", establishment: { id: AG.id, name: AG.name } },
  { id: "f-op-caixa", name: "COM OP CAIXA", establishment: { id: SUPLEMENTO.id, name: SUPLEMENTO.name } },
];
const ROTULOS = { papeis: { COLABORADOR: "Colaborador" }, vinculos: { EMPLOYEE: "Empregado" } };

/** Uma linha da folha, coluna por coluna, como no arquivo real. */
function linhaDaFolha(p: {
  codEmpresa: string;
  matricula: string;
  nome: string;
  cpf: string;
  nascimento: string;
  admissao: string;
  cargo: string;
  empresa?: string;
}): string[] {
  const valores: Record<string, string> = {
    "Cód. Empresa": p.codEmpresa,
    Empresa: p.empresa ?? "SUPER SHOPPING DA UTILIDADE DE AMERICANA LTDA",
    Competência: "10/2026",
    "Cód. Func.": p.matricula,
    Nome: p.nome,
    CPF: p.cpf,
    RG: "123456789",
    PIS: "12345678901",
    "Data Nasc.": p.nascimento,
    Admissão: p.admissao,
    Cargo: p.cargo,
    "CBO 94": "0.11-05",
    "CBO 2002": "5211-25",
    "Tipo Salário": "M",
    Salário: "2500",
    Cidade: "AMERICANA - SP",
    "Data Relatório": "46332",
  };
  return CABECALHO_DA_FOLHA.map((c) => valores[c] ?? "");
}

const ANA = cpf("111444777");
const BIA = cpf("222555888");
const CAIO = cpf("333666999");

describe("a planilha da folha é lida como sai do sistema de folha [PF-1]", () => {
  it("a filial vem do Cód. Empresa, a matrícula do Cód. Func. e a função do Cargo", () => {
    const lido = lerTabela(
      [
        [...CABECALHO_DA_FOLHA],
        linhaDaFolha({ codEmpresa: "0682", matricula: "000004", nome: "ANA REPOSITORA", cpf: ANA, nascimento: "30827", admissao: "43270", cargo: "REPOSITORA" }),
        linhaDaFolha({ codEmpresa: "0683", matricula: "000004", nome: "BIA AUXILIAR", cpf: BIA, nascimento: "05/01/1990", admissao: "2020-02-01", cargo: "AUXILIAR ADMINISTRATIVO" }),
        linhaDaFolha({ codEmpresa: "961", matricula: "000171", nome: "CAIO CAIXA", cpf: CAIO, nascimento: "37822", admissao: "45674", cargo: "COM OP CAIXA" }),
      ],
      FUNCOES,
      [],
      ROTULOS,
      FILIAIS,
    );
    expect(lido.problems).toEqual([]);
    expect(lido.modelo).toBe("folha");
    expect(lido.numeros).toEqual([2, 3, 4]);
    expect(lido.rows).toEqual([
      {
        name: "ANA REPOSITORA",
        registration: "000004",
        tax_id: ANA,
        job_role_id: "f-repositora",
        admitted_at: "2018-06-19",
        birth_date: "1984-05-25",
        bond: "EMPLOYEE",
        payroll: { competence: "2026-10", rg: "123456789", pis: "12345678901", salary_type: "M", city: "AMERICANA - SP" },
        job_role_cbo2002: "5211-25",
        job_role_cbo94: "0.11-05",
        establishment_id: LOJA.id,
      },
      {
        name: "BIA AUXILIAR",
        registration: "000004",
        tax_id: BIA,
        job_role_id: "f-aux-adm",
        admitted_at: "2020-02-01",
        birth_date: "1990-01-05",
        bond: "EMPLOYEE",
        payroll: { competence: "2026-10", rg: "123456789", pis: "12345678901", salary_type: "M", city: "AMERICANA - SP" },
        job_role_cbo2002: "5211-25",
        job_role_cbo94: "0.11-05",
        establishment_id: AG.id,
      },
      {
        name: "CAIO CAIXA",
        registration: "000171",
        tax_id: CAIO,
        job_role_id: "f-op-caixa",
        admitted_at: "2025-01-17",
        birth_date: "2003-07-20",
        bond: "EMPLOYEE",
        payroll: { competence: "2026-10", rg: "123456789", pis: "12345678901", salary_type: "M", city: "AMERICANA - SP" },
        job_role_cbo2002: "5211-25",
        job_role_cbo94: "0.11-05",
        establishment_id: SUPLEMENTO.id,
      },
    ]);
  });

  it("o que o portal não tinha vai para os dados da folha, com as datas e a competência convertidas [PF-2]", () => {
    const cheia = CABECALHO_DA_FOLHA.map((c) =>
      ({
        "Cód. Empresa": "0682",
        Competência: "11/2026",
        "Cód. Func.": "7",
        Nome: "ANA",
        CPF: ANA,
        RG: "MG-12.345.678",
        PIS: "12345678901",
        CTPS: "65333",
        "CTPS Série": "0282",
        "CTPS UF": "sp",
        "Dt. Rescisão": "46000",
        "Causa Rescisão": "Pedido de demissão",
        "Tipo Movimento": "D",
        Cargo: "REPOSITOR",
        "CBO 94": "0.11-05",
        "CBO 2002": "5211-25",
        "Tipo Salário": "P",
        Salário: "1800",
        "Data Opção FGTS": "15/03/2019",
        "Nº Dependentes": "2",
        "Grau Instrução": "7",
        "Cód. Nacionalidade": "22",
        Endereço: "R Manguezal, 78",
        Complemento: "casa 2",
        Bairro: "Jardim",
        Cidade: "AMERICANA - SP",
        "Data Relatório": "46332",
      })[c] ?? "",
    );
    const lido = lerTabela([[...CABECALHO_DA_FOLHA], cheia], FUNCOES, [], ROTULOS, FILIAIS);
    expect(lido.problems).toEqual([]);
    expect(lido.rows[0]!.payroll).toEqual({
      competence: "2026-11",
      rg: "MG-12.345.678",
      pis: "12345678901",
      ctps_number: "65333",
      ctps_series: "0282",
      ctps_uf: "sp",
      termination_date: "2025-12-09",
      termination_cause: "Pedido de demissão",
      movement_type: "D",
      salary_type: "P",
      fgts_option_date: "2019-03-15",
      dependents: "2",
      education_level: "7",
      nationality_code: "22",
      address: "R Manguezal, 78",
      address_complement: "casa 2",
      district: "Jardim",
      city: "AMERICANA - SP",
    });
    expect(lido.rows[0]!.job_role_cbo2002).toBe("5211-25");
    expect(lido.rows[0]!.job_role_cbo94).toBe("0.11-05");
    expect(JSON.stringify(lido.rows)).not.toContain("1800");
    expect(JSON.stringify(lido.rows)).not.toContain("46332");
  });

  it("a coluna Empresa não vira empresa contratada, e o salário não sai da planilha", () => {
    const lido = lerTabela(
      [
        [...CABECALHO_DA_FOLHA],
        linhaDaFolha({ codEmpresa: "0682", matricula: "1", nome: "ANA", cpf: ANA, nascimento: "30827", admissao: "43270", cargo: "REPOSITOR", empresa: "Terceira Ltda" }),
      ],
      FUNCOES,
      [{ id: "c-terceira", name: "Terceira Ltda" }],
      ROTULOS,
      FILIAIS,
    );
    expect(lido.rows[0]!.contractor_id).toBeUndefined();
    expect(lido.rows[0]!.bond).toBe("EMPLOYEE");
    expect(JSON.stringify(lido.rows)).not.toContain("2500");
  });

  it("cargo com outra grafia não casa: REPOSITORA não é REPOSITOR, e a linha avisa", () => {
    const lido = lerTabela(
      [
        [...CABECALHO_DA_FOLHA],
        linhaDaFolha({ codEmpresa: "0683", matricula: "9", nome: "BIA", cpf: BIA, nascimento: "30827", admissao: "43270", cargo: "REPOSITORA" }),
      ],
      FUNCOES,
      [],
      ROTULOS,
      FILIAIS,
    );
    expect(lido.problems).toEqual([`Linha 2: função "REPOSITORA" não existe na filial "Administrativo".`]);
    expect(lido.rows[0]!.job_role_id).toBeUndefined();
    expect(lido.rows[0]!.establishment_id).toBe(AG.id);
  });

  it("código sem filial e código em duas filiais voltam com o motivo, e a linha não vai", () => {
    const duplicada: FilialDaEmpresa = { id: "e-dup", name: "Outra Loja", taxId: null, payrollCode: "682" };
    const lido = lerTabela(
      [
        [...CABECALHO_DA_FOLHA],
        linhaDaFolha({ codEmpresa: "0999", matricula: "1", nome: "ANA", cpf: ANA, nascimento: "30827", admissao: "43270", cargo: "REPOSITOR" }),
        linhaDaFolha({ codEmpresa: "0682", matricula: "2", nome: "BIA", cpf: BIA, nascimento: "30827", admissao: "43270", cargo: "REPOSITOR" }),
        linhaDaFolha({ codEmpresa: "", matricula: "3", nome: "CAIO", cpf: CAIO, nascimento: "30827", admissao: "43270", cargo: "REPOSITOR" }),
      ],
      FUNCOES,
      [],
      ROTULOS,
      [...FILIAIS, duplicada],
    );
    expect(lido.rows).toEqual([]);
    expect(lido.problems).toEqual([
      "Linha 2: código 0999 não é de nenhuma filial. Preencha o código da folha em Operação → Estabelecimentos.",
      "Linha 3: o código 0682 está em mais de uma filial (Loja Americana e Outra Loja). Corrija em Operação → Estabelecimentos.",
      "Linha 4: sem o Cód. Empresa — a empresa tem mais de uma filial.",
    ]);
  });

  it("CPF repetido no arquivo e matrícula repetida na mesma filial param na segunda linha", () => {
    const lido = lerTabela(
      [
        [...CABECALHO_DA_FOLHA],
        linhaDaFolha({ codEmpresa: "0682", matricula: "000153", nome: "ANA", cpf: ANA, nascimento: "30827", admissao: "43270", cargo: "REPOSITOR" }),
        linhaDaFolha({ codEmpresa: "0682", matricula: "153", nome: "BIA", cpf: BIA, nascimento: "30827", admissao: "43270", cargo: "REPOSITOR" }),
        linhaDaFolha({ codEmpresa: "0683", matricula: "153", nome: "CAIO", cpf: ANA, nascimento: "30827", admissao: "43270", cargo: "AUXILIAR ADMINISTRATIVO" }),
        linhaDaFolha({ codEmpresa: "0683", matricula: "153", nome: "CAIO", cpf: CAIO, nascimento: "30827", admissao: "43270", cargo: "AUXILIAR ADMINISTRATIVO" }),
      ],
      FUNCOES,
      [],
      ROTULOS,
      FILIAIS,
    );
    expect(lido.problems).toEqual([
      "Linha 3: matrícula 153 repetida na mesma filial (já está na linha 2).",
      "Linha 4: CPF repetido na planilha (já está na linha 2).",
    ]);
    expect(lido.numeros).toEqual([2, 5]);
  });

  it("coluna fora do modelo da folha é apontada, como no CSV", () => {
    const lido = lerTabela(
      [[...CABECALHO_DA_FOLHA, "Observação"], linhaDaFolha({ codEmpresa: "0682", matricula: "1", nome: "ANA", cpf: ANA, nascimento: "30827", admissao: "43270", cargo: "REPOSITOR" })],
      FUNCOES,
      [],
      ROTULOS,
      FILIAIS,
    );
    expect(lido.problems[0]).toMatch(/^Coluna não reconhecida: "observacao"\. O portal lê Cód\. Empresa, Empresa,/);
  });

  it("CPF gravado como número no Excel perde o zero da frente, e volta com ele", () => {
    const comZero = cpf("012345678");
    const lido = lerTabela(
      [[...CABECALHO_DA_FOLHA], linhaDaFolha({ codEmpresa: "0682", matricula: "1", nome: "ANA", cpf: comZero.replace(/^0/, ""), nascimento: "30827", admissao: "43270", cargo: "REPOSITOR" })],
      FUNCOES,
      [],
      ROTULOS,
      FILIAIS,
    );
    expect(lido.rows[0]!.tax_id).toBe(comZero);
  });

  it("data do Excel em número de série (dias desde 30/12/1899); o que não é número de série fica como está", () => {
    expect(dataDoExcel("30827")).toBe("1984-05-25");
    expect(dataDoExcel("45674")).toBe("2025-01-17");
    expect(dataDoExcel("05/01/1990")).toBeNull();
    expect(dataDoExcel("0")).toBeNull();
  });
});

describe("o .xlsx é lido sem biblioteca [PF-1]", () => {
  it("o modelo gerado volta igual, com acento e símbolo, e a linha fica no número do Excel", async () => {
    const linhas = [[...CABECALHO_DA_FOLHA], [], ["0682", "Ação & <Cia>", "", "000004"]];
    const lido = await lerXlsx(gerarXlsx(linhas, "Funcionários"));
    expect(lido[0]).toEqual([...CABECALHO_DA_FOLHA]);
    expect(lido[1]).toEqual([]);
    expect(lido[2]).toEqual(["0682", "Ação & <Cia>", "", "000004"]);
  });

  it("a planilha lida do .xlsx numera a pessoa pela linha do Excel, pulando a linha em branco", async () => {
    const xlsx = gerarXlsx([
      [...CABECALHO_DA_FOLHA],
      [],
      linhaDaFolha({ codEmpresa: "0682", matricula: "1", nome: "ANA", cpf: ANA, nascimento: "30827", admissao: "43270", cargo: "REPOSITOR" }),
    ]);
    const lido = lerTabela(await lerXlsx(xlsx), FUNCOES, [], ROTULOS, FILIAIS);
    expect(lido.numeros).toEqual([3]);
  });

  it("o .xlsx salvo pelo Excel (texto compartilhado, conteúdo comprimido, número e célula pulada) é lido", async () => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?>';
    const arquivos: [string, string][] = [
      ["xl/workbook.xml", `${xml}<workbook xmlns:r="r"><sheets><sheet name="Funcionários" sheetId="1" r:id="rId7"/></sheets></workbook>`],
      ["xl/_rels/workbook.xml.rels", `${xml}<Relationships><Relationship Id="rId7" Type="worksheet" Target="/xl/worksheets/folha.xml"/></Relationships>`],
      [
        "xl/sharedStrings.xml",
        `${xml}<sst count="3"><si><t>Cód. Empresa</t></si><si><r><t>Cód. </t></r><r><t>Func.</t></r></si><si><t xml:space="preserve">José &amp; Filhos</t><rPh><t>ジョゼ</t></rPh></si></sst>`,
      ],
      [
        "xl/worksheets/folha.xml",
        `${xml}<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="4"><c r="A4"><v>682</v></c><c r="C4" t="s"><v>2</v></c></row></sheetData></worksheet>`,
      ],
    ];
    const lido = await lerXlsx(zipComprimido(arquivos));
    expect(lido).toEqual([["Cód. Empresa", "Cód. Func."], [], [], ["682", "", "José & Filhos"]]);
  });

  it("arquivo protegido por senha (ou .xls antigo) e arquivo que não é planilha dão o mesmo aviso", async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(600).fill(0)]);
    await expect(lerXlsx(ole)).rejects.toBeInstanceOf(PlanilhaIlegivel);
    await expect(lerXlsx(new TextEncoder().encode("nome;cpf\nAna;1"))).rejects.toThrow(
      "Não consegui ler este arquivo. Salve como .xlsx sem senha e envie de novo.",
    );
  });
});

describe("o envio vai em lotes de 200 e o relatório soma tudo [PF-1]", () => {
  it("450 linhas viram 3 envios, e cada resultado aponta a linha do Excel", async () => {
    const linhas = Array.from({ length: 450 }, (_, i) => ({ name: `P${i}` }));
    const numeros = linhas.map((_, i) => i + 10);
    const envios: number[] = [];
    const avancos: string[] = [];
    const r = await importarEmLotes(
      linhas,
      numeros,
      async (lote) => {
        envios.push(lote.length);
        return {
          dry_run: true,
          rows: lote.length,
          created: lote.length - 1,
          completed: 0,
          skipped: 0,
          errors: 1,
          results: lote.map((_, i) => ({ line: i + 1, status: i === 0 ? "error" : "created" })),
        };
      },
      200,
      (feitas, total) => avancos.push(`${feitas}/${total}`),
    );
    expect(envios).toEqual([200, 200, 50]);
    expect(avancos).toEqual(["200/450", "400/450", "450/450"]);
    expect(r).toMatchObject({ dry_run: true, rows: 450, created: 447, errors: 3 });
    expect(r.results.filter((x) => x.status === "error").map((x) => x.line)).toEqual([10, 210, 410]);
    expect(r.results.at(-1)!.line).toBe(459);
  });

  it("um lote que falha interrompe: o erro sobe e os lotes seguintes não vão", async () => {
    const envios: number[] = [];
    await expect(
      importarEmLotes(
        Array.from({ length: 5 }, () => ({})),
        [2, 3, 4, 5, 6],
        async (lote) => {
          envios.push(lote.length);
          if (envios.length === 2) throw new Error("Falha de rede");
          return { dry_run: false, rows: lote.length, created: lote.length, completed: 0, skipped: 0, errors: 0, results: [] };
        },
        2,
      ),
    ).rejects.toThrow("Falha de rede");
    expect(envios).toEqual([2, 2]);
  });
});

/** Zip com conteúdo comprimido (método 8), como o Excel grava. */
function zipComprimido(arquivos: [string, string][]): Uint8Array {
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [nome, conteudo] of arquivos) {
    const n = Buffer.from(nome, "utf8");
    const bruto = Buffer.from(conteudo, "utf8");
    const d = deflateRawSync(bruto);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(d.length, 18);
    local.writeUInt32LE(bruto.length, 22);
    local.writeUInt16LE(n.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(d.length, 20);
    cd.writeUInt32LE(bruto.length, 24);
    cd.writeUInt16LE(n.length, 28);
    cd.writeUInt32LE(offset, 42);
    partes.push(local, n, d);
    central.push(cd, n);
    offset += 30 + n.length + d.length;
  }
  const tamanho = central.reduce((t, c) => t + c.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(tamanho, 12);
  fim.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...partes, ...central, fim]));
}

describe("datas que o Excel grava no CSV [C4-3]", () => {
  const ROT = { papeis: { COLABORADOR: "Colaborador" }, vinculos: { EMPLOYEE: "Empregado" } };
  const ler = (admissao: string, nascimento: string) =>
    lerLinhas(`nome;admissao;nascimento\nAna;${admissao};${nascimento}`, [], [], ROT, []).rows[0]!;

  it("número de série vira a data: 46338 é 12/11/2026 e 34462 é 08/05/1994", () => {
    expect(ler("46338", "34462")).toMatchObject({ admitted_at: "2026-11-12", birth_date: "1994-05-08" });
  });

  it("d/m/aaaa ganha os zeros, e aaaa/mm/dd e aaaa-mm-dd viram AAAA-MM-DD", () => {
    expect(ler("1/2/1990", "2024/3/5")).toMatchObject({ admitted_at: "1990-02-01", birth_date: "2024-03-05" });
    expect(ler("15/01/2024", "1990-01-05")).toMatchObject({ admitted_at: "2024-01-15", birth_date: "1990-01-05" });
  });

  it("o que não é data passa como veio, para o servidor recusar com o motivo", () => {
    expect(normalizarData("ontem")).toBe("ontem");
    expect(normalizarData("31/02/2020")).toBe("2020-02-31");
  });
});
