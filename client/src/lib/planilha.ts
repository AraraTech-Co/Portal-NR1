/**
 * A leitura da planilha de cadastro em massa.
 *
 * Estava dentro da tela, em `ImportPeople.tsx`, onde não dava para testar sem
 * navegador — e é esta função que decide se a pessoa entra, com que função e
 * ligada a que empresa. Aqui ela não depende de nada do cliente: os rótulos
 * de papel e de vínculo chegam por parâmetro. [B3-1-B] [S1-G]
 */

export type LinhaDaPlanilha = {
  name: string;
  registration?: string;
  tax_id?: string;
  email?: string;
  job_role_id?: string;
  admitted_at?: string;
  /** Nascimento, um dos três dados do primeiro acesso. [C1-7] */
  birth_date?: string;
  bond?: string;
  org_role?: string;
  contractor_id?: string;
  /** A filial da linha, resolvida pelo nome ou pelo CNPJ. [C3-3] */
  establishment_id?: string;
  /** Os dados da planilha da folha que o portal guarda à parte da ficha. [PF-2] */
  payroll?: Record<string, string>;
  /** O CBO do cargo, que vai para a função. [PF-2] */
  job_role_cbo2002?: string;
  job_role_cbo94?: string;
};

/** Coluna da folha que vai para os dados da folha: `payroll:<campo>`. [PF-2] */
type Destino = keyof LinhaLocal | `payroll:${string}`;

type LinhaLocal = LinhaDaPlanilha & { establishment?: string; payroll_code?: string };

export type FuncaoDaEmpresa = {
  id: string;
  name: string;
  establishment?: { id?: string; name: string } | null;
};

/**
 * As filiais ativas da empresa, como vêm de `/api/establishments`. [C3-3]
 * O código da folha (C3-4) é como a planilha da folha diz a filial. [PF-1]
 */
export type FilialDaEmpresa = {
  id: string;
  name: string;
  taxId: string | null;
  payrollCode?: string | null;
};

/** Uma linha da planilha que não vai ao servidor, com o porquê. */
export type LinhaRecusada = { linha: number; nome: string; motivos: string[] };

export type Lido = {
  rows: LinhaDaPlanilha[];
  problems: string[];
  /**
   * As linhas que ficaram de fora, para a prévia mostrá-las na tabela e na
   * contagem: antes elas só apareciam numa lista acima do botão, fora da
   * prévia, e era fácil cadastrar sem ver. Problema de linha que entrou é
   * aviso dela, não recusa.
   */
  recusadas: LinhaRecusada[];
  /** O número da linha no Excel de cada linha de `rows`, na mesma ordem. */
  numeros: number[];
  /** Em que modelo a planilha veio. [PF-1] */
  modelo: "folha" | "csv" | null;
};

export type RotulosDaPlanilha = {
  /** código → rótulo, como ORG_ROLE_LABEL e WORKER_BOND_LABEL. */
  papeis: Record<string, string>;
  vinculos: Record<string, string>;
};

/** A mesma regra do servidor: o que não cabe num nome. [B2-1-L] */
const CPF_SOLTO = /\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}/;
const DATA_SOLTA = /\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/;

/**
 * Os cabeçalhos que o portal reconhece.
 *
 * O da esquerda em cada par é o nome oficial, o mesmo que sai no modelo e
 * aparece na explicação da tela; os outros são jeitos de escrever a mesma
 * coluna. Antes a explicação dizia "empresa contratada" e o portal só
 * reconhecia "empresa": quem seguia a tela via o terceirizado entrar sem
 * empresa, calado. [B3-1-B] [S1-R]
 */
export const CABECALHO_OFICIAL = [
  "nome",
  "matricula",
  "cpf",
  "email",
  "funcao",
  "filial",
  "admissao",
  "vinculo",
  "empresa contratada",
  "papel",
  "nascimento",
] as const;

const COLUNAS: Record<string, keyof LinhaLocal> = {
  nome: "name",
  name: "name",
  matricula: "registration",
  registration: "registration",
  cpf: "tax_id",
  email: "email",
  "e-mail": "email",
  funcao: "job_role_id",
  cargo: "job_role_id",
  admissao: "admitted_at",
  "data de admissao": "admitted_at",
  nascimento: "birth_date",
  "data de nascimento": "birth_date",
  vinculo: "bond",
  papel: "org_role",
  /// Terceirizado sem empresa deixa a lacuna à mostra na ficha. [S1-R] [CB-8]
  "empresa contratada": "contractor_id",
  empresa: "contractor_id",
  contratada: "contractor_id",
  /// A filial da pessoa, pelo nome ou pelo CNPJ. [C3-3]
  /// "unidade" é o nome antigo, das planilhas montadas antes. [CB-6]
  filial: "establishment",
  unidade: "establishment",
  estabelecimento: "establishment",
};

/**
 * O modelo da planilha de funcionários: as colunas da exportação do sistema
 * de folha, na ordem em que saem. O RH envia o arquivo como vem, e o modelo
 * que o portal oferece é este. [PF-1]
 */
export const CABECALHO_DA_FOLHA = [
  "Cód. Empresa",
  "Empresa",
  "Competência",
  "Cód. Func.",
  "Nome",
  "CPF",
  "RG",
  "PIS",
  "CTPS",
  "CTPS Série",
  "CTPS UF",
  "Data Nasc.",
  "Admissão",
  "Dt. Rescisão",
  "Causa Rescisão",
  "Tipo Movimento",
  "Cargo",
  "CBO 94",
  "CBO 2002",
  "Tipo Salário",
  "Salário",
  "Data Opção FGTS",
  "Nº Dependentes",
  "Grau Instrução",
  "Cód. Nacionalidade",
  "Endereço",
  "Complemento",
  "Bairro",
  "Cidade",
  "Data Relatório",
] as const;

/** "Cód. Func." → "cod func": sem acento, sem pontuação, sem caixa. */
export function chaveDaFolha(cabecalho: string): string {
  return semAcento(cabecalho)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * O que cada coluna da folha vira. `null` é coluna conhecida que esta
 * leitura não usa: a "Empresa" repete a filial (e não é empresa contratada),
 * e o salário fica fora por decisão do Leonardo (12/11/2026). [PF-1]
 */
const COLUNAS_DA_FOLHA: Record<string, Destino | null> = Object.fromEntries(
  CABECALHO_DA_FOLHA.map((c) => [chaveDaFolha(c), null]),
);
Object.assign(COLUNAS_DA_FOLHA, {
  "cod empresa": "payroll_code",
  "cod func": "registration",
  nome: "name",
  cpf: "tax_id",
  "data nasc": "birth_date",
  admissao: "admitted_at",
  cargo: "job_role_id",
  /* O que o portal não tinha vai para os dados da folha (12/11/2026). [PF-2] */
  competencia: "payroll:competence",
  rg: "payroll:rg",
  pis: "payroll:pis",
  ctps: "payroll:ctps_number",
  "ctps serie": "payroll:ctps_series",
  "ctps uf": "payroll:ctps_uf",
  "dt rescisao": "payroll:termination_date",
  "causa rescisao": "payroll:termination_cause",
  "tipo movimento": "payroll:movement_type",
  "tipo salario": "payroll:salary_type",
  "data opcao fgts": "payroll:fgts_option_date",
  "n dependentes": "payroll:dependents",
  "grau instrucao": "payroll:education_level",
  "cod nacionalidade": "payroll:nationality_code",
  endereco: "payroll:address",
  complemento: "payroll:address_complement",
  bairro: "payroll:district",
  cidade: "payroll:city",
  "cbo 2002": "job_role_cbo2002",
  "cbo 94": "job_role_cbo94",
} satisfies Record<string, Destino>);

/** Campos dos dados da folha que são data, para converter o número de série. */
const DATAS_DA_FOLHA = ["fgts_option_date", "termination_date"];

/** Uma planilha é a da folha quando traz as duas colunas de código. */
function ehDaFolha(cabecalho: string[]): boolean {
  const chaves = cabecalho.map(chaveDaFolha);
  return chaves.includes("cod empresa") && chaves.includes("cod func");
}

/** Número de série do Excel (dias desde 30/12/1899) → AAAA-MM-DD. */
export function dataDoExcel(valor: string): string | null {
  if (!/^\d+(\.\d+)?$/.test(valor)) return null;
  const dias = Math.floor(Number(valor));
  if (dias < 1 || dias > 80000) return null;
  return new Date(Date.UTC(1899, 11, 30) + dias * 86400000).toISOString().slice(0, 10);
}

/**
 * Data como o Excel e as pessoas escrevem, em AAAA-MM-DD: número de série,
 * dd/mm/aaaa (também d/m/aaaa), aaaa-mm-dd e aaaa/mm/dd. O resto volta como
 * veio, e o servidor recusa pedindo dd/mm/aaaa. [C4-3]
 */
export function normalizarData(valor: string): string {
  const v = valor.trim();
  const serie = dataDoExcel(v);
  if (serie) return serie;
  const pad = (n: string) => n.padStart(2, "0");
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (br) return `${br[3]}-${pad(br[2]!)}-${pad(br[1]!)}`;
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(v);
  if (iso) return `${iso[1]}-${pad(iso[2]!)}-${pad(iso[3]!)}`;
  return v;
}

/** "0682" e "682" são o mesmo código; letras ficam como estão, sem caixa. */
function codigoCanonico(codigo: string): string {
  const c = codigo.trim().toUpperCase();
  return /^\d+$/.test(c) ? c.replace(/^0+(?=\d)/, "") : c;
}

/**
 * Papéis que a planilha aceita.
 *
 * Fora: master e dono da conta (não se dá por planilha), "Admin (legado)"
 * (ninguém escolhe de propósito um papel chamado legado) e o fiscal, cujo
 * acesso tem prazo e vem pelo pedido de entrada. [B2-1-D] [S7-A]
 */

export function pareceLinhaInteira(nome: string): boolean {
  return (
    nome.includes("@") ||
    CPF_SOLTO.test(nome) ||
    DATA_SOLTA.test(nome) ||
    nome.length > 80
  );
}

/**
 * A chave com que a planilha casa nomes (função, filial, setor). A importação
 * de funções usa a mesma regra no servidor (`chaveDoNome`): com outra chave,
 * "Caixa" nasceria ao lado de "CAIXA" e as duas ficariam ambíguas aqui.
 */
export function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Pelo CNPJ (só os 14 dígitos contam) ou pelo nome, sem acento. [C3-3] */
function acharFilial(
  texto: string,
  filiais: FilialDaEmpresa[],
): FilialDaEmpresa | undefined {
  const digitos = texto.replace(/\D/g, "");
  if (digitos.length === 14) {
    const porCnpj = filiais.find((f) => (f.taxId ?? "").replace(/\D/g, "") === digitos);
    if (porCnpj) return porCnpj;
  }
  return filiais.find((f) => semAcento(f.name) === semAcento(texto));
}

function separador(linha: string): string {
  if (linha.includes("\t")) return "\t";
  if (linha.includes(";")) return ";";
  return ",";
}



/**
 * Lê a planilha colada. O vínculo e a função chegam por nome na planilha e
 * saem daqui como código e id — quem monta a planilha escreve "Vendedor",
 * não um uuid. [S1-A]
 *
 * A filial chega pelo nome ou pelo CNPJ e sai como id; com mais de uma
 * filial na empresa, é obrigatória. Sem a lista de filiais, a coluna só
 * desempata a função pelo nome, como antes. [C3-3]
 */
export function lerLinhas(
  texto: string,
  funcoes: FuncaoDaEmpresa[],
  empresas: { id: string; name: string }[],
  rotulos: RotulosDaPlanilha,
  filiais: FilialDaEmpresa[] = [],
): Lido {
  const linhas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (linhas.length === 0) return { rows: [], problems: [], recusadas: [], numeros: [], modelo: null };
  const sep = separador(linhas[0]!);
  return lerTabela(
    linhas.map((l) => l.split(sep).map((c) => c.trim())),
    funcoes,
    empresas,
    rotulos,
    filiais,
    "texto",
  );
}

/**
 * Lê a planilha já separada em células: a do CSV (linhas sem as em branco,
 * numeradas na ordem) ou a do `.xlsx` (cada linha na posição do Excel). A
 * planilha da folha é reconhecida pelo cabeçalho. [PF-1]
 */
export function lerTabela(
  matriz: string[][],
  funcoes: FuncaoDaEmpresa[],
  empresas: { id: string; name: string }[],
  rotulos: RotulosDaPlanilha,
  filiais: FilialDaEmpresa[] = [],
  origem: "texto" | "xlsx" = "xlsx",
): Lido {
  const inicio = matriz.findIndex((l) => l.some((c) => c !== ""));
  if (inicio < 0) return { rows: [], problems: [], recusadas: [], numeros: [], modelo: null };
  const primeira = matriz[inicio]!;
  const daFolha = ehDaFolha(primeira);
  const cabecalho = daFolha ? primeira.map(chaveDaFolha) : primeira.map((c) => semAcento(c));
  const temCabecalho = daFolha || cabecalho.some((c) => c in COLUNAS);
  /*
    Coluna com cabeçalho que o portal não conhece era deixada de lado em
    silêncio: a empresa montava a planilha seguindo a tela e o dado não
    entrava, sem ninguém perceber. [B3-1-B]
  */
  const conhecidas: Record<string, Destino | null> = daFolha ? COLUNAS_DA_FOLHA : COLUNAS;
  const colunasIgnoradas = temCabecalho
    ? cabecalho.filter((c) => c && !(c in conhecidas))
    : [];
  const campos = temCabecalho
    ? cabecalho.map((c) => conhecidas[c] ?? null)
    : ([
        "name",
        "registration",
        "tax_id",
        "email",
        "job_role_id",
        "admitted_at",
        "bond",
      ] as (keyof LinhaLocal)[]);

  /*
    Função com o mesmo nome em duas unidades casava pela primeira encontrada
    e ligava a pessoa à unidade errada, sem aviso. [CB-6]
  */
  const porNome = new Map<string, FuncaoDaEmpresa[]>();
  for (const f of funcoes) {
    const chave = semAcento(f.name);
    porNome.set(chave, [...(porNome.get(chave) ?? []), f]);
  }
  const empresaPorNome = new Map(empresas.map((c) => [semAcento(c.name), c.id]));
  const vinculos = new Map(
    Object.entries(rotulos.vinculos).map(([codigo, rotulo]) => [semAcento(rotulo), codigo]),
  );
  const papeis = new Map(
    Object.entries(rotulos.papeis).map(([codigo, rotulo]) => [semAcento(rotulo), codigo]),
  );

  /* Filial de cada código da folha; código em duas filiais é ambíguo. [PF-1] */
  const porCodigo = new Map<string, FilialDaEmpresa[]>();
  for (const f of filiais) {
    if (!f.payrollCode) continue;
    const k = codigoCanonico(f.payrollCode);
    porCodigo.set(k, [...(porCodigo.get(k) ?? []), f]);
  }

  const rows: LinhaDaPlanilha[] = [];
  const numeros: number[] = [];
  const problems: string[] = [];
  /* Repetição dentro do arquivo: com o envio em lotes, o servidor só vê a do lote. [PF-1] */
  const cpfVisto = new Map<string, number>();
  /* O nome de cada linha, para a recusa aparecer com ele na prévia. */
  const nomeDaLinha = new Map<number, string>();
  const matriculaVista = new Map<string, number>();

  if (colunasIgnoradas.length > 0) {
    problems.push(
      `Coluna não reconhecida: ${colunasIgnoradas
        .map((c) => `"${c}"`)
        .join(", ")}. O portal lê ${(daFolha ? CABECALHO_DA_FOLHA : CABECALHO_OFICIAL).join(
        ", ",
      )} — baixe o modelo para usar os mesmos nomes.`,
    );
  }

  for (const [i, celulasBrutas] of matriz.entries()) {
    if (i < inicio || (temCabecalho && i === inicio)) continue;
    if (!celulasBrutas.some((c) => c !== "")) continue;
    /*
      A linha é numerada como no Excel: com cabeçalho, a primeira pessoa está
      na linha 2. Antes a prévia dizia "Linha 1" para ela, e quem conferia no
      Excel procurava no lugar errado. [S1-G]
    */
    const numero = i + 1;
    const celulas = celulasBrutas.map((c) => c.trim());
    const row: LinhaDaPlanilha = { name: "" };
    celulas.forEach((valor, coluna) => {
      const campo = campos[coluna];
      if (!campo || !valor) return;
      if (campo.startsWith("payroll:")) {
        (row.payroll ??= {})[campo.slice(8)] = valor;
        return;
      }
      (row as unknown as Record<string, string>)[campo] = valor;
    });

    if (!row.name) {
      problems.push(`Linha ${numero}: sem nome.`);
      continue;
    }
    nomeDaLinha.set(numero, row.name);

    /*
      Linha copiada do Excel que perde as tabulações vira uma coluna só: o
      nome passava a ser a linha inteira e a prévia dava "Entra" para uma
      pessoa sem matrícula, sem CPF e sem função. A prévia existe para
      proteger. [B2-1-L]
    */
    if (origem === "texto" && temCabecalho && cabecalho.length > 1 && celulas.length === 1) {
      problems.push(
        `Linha ${numero}: veio sem separador — o cabeçalho tem ${cabecalho.length} colunas e esta linha tem 1. Cole de novo mantendo o ponto e vírgula ou a tabulação.`,
      );
      continue;
    }
    if (temCabecalho && celulas.length > cabecalho.length) {
      problems.push(
        `Linha ${numero}: tem ${celulas.length} colunas e o cabeçalho tem ${cabecalho.length}. Deve haver um separador dentro de algum campo.`,
      );
      continue;
    }
    /*
      Arroba, CPF ou data dentro do nome é sinal de linha inteira caída ali,
      ou de coluna trocada. Dígito solto passa: há quem se chame "Maria de
      Souza 2" na folha. [B2-1-L]
    */
    if (pareceLinhaInteira(row.name)) {
      problems.push(
        `Linha ${numero}: "${row.name.slice(0, 40)}${
          row.name.length > 40 ? "…" : ""
        }" não parece um nome — tem arroba, CPF ou data dentro. Confira se as colunas estão no lugar.`,
      );
      continue;
    }
    let unidade = (row as LinhaLocal).establishment;
    delete (row as LinhaLocal).establishment;
    const codigo = (row as LinhaLocal).payroll_code;
    delete (row as LinhaLocal).payroll_code;
    let filial: FilialDaEmpresa | undefined;
    if (daFolha) {
      /*
        Na planilha da folha, a filial vem pelo código da empresa na folha,
        o mesmo do cadastro da filial. A razão social não serve: a loja e a
        de suplementos têm a mesma. Todo mundo na folha é empregado. [PF-1]
      */
      row.bond = "EMPLOYEE";
      if (codigo) {
        const achadas = porCodigo.get(codigoCanonico(codigo)) ?? [];
        if (achadas.length === 0) {
          problems.push(
            `Linha ${numero}: código ${codigo} não é de nenhuma filial. Preencha o código da folha em Operação → Estabelecimentos.`,
          );
          continue;
        }
        if (achadas.length > 1) {
          problems.push(
            `Linha ${numero}: o código ${codigo} está em mais de uma filial (${achadas
              .map((f) => f.name)
              .join(" e ")}). Corrija em Operação → Estabelecimentos.`,
          );
          continue;
        }
        filial = achadas[0]!;
        unidade = filial.name;
        row.establishment_id = filial.id;
      } else if (filiais.length > 1) {
        problems.push(
          `Linha ${numero}: sem o Cód. Empresa — a empresa tem mais de uma filial.`,
        );
        continue;
      }
    } else if (unidade && filiais.length > 0) {
      filial = acharFilial(unidade, filiais);
      if (!filial) {
        problems.push(`Linha ${numero}: filial "${unidade}" não existe nesta empresa.`);
        continue;
      }
      row.establishment_id = filial.id;
    } else if (!unidade && filiais.length > 1) {
      problems.push(
        `Linha ${numero}: informe a filial — a empresa tem mais de uma. Use o nome ou o CNPJ da filial.`,
      );
      continue;
    }
    if (row.job_role_id) {
      const nomeDaFuncao = row.job_role_id;
      let candidatas = porNome.get(semAcento(nomeDaFuncao)) ?? [];
      if (filial) {
        const daFilial = filial;
        candidatas = candidatas.filter((f) =>
          f.establishment?.id
            ? f.establishment.id === daFilial.id
            : semAcento(f.establishment?.name ?? "") === semAcento(daFilial.name),
        );
      } else if (unidade) {
        candidatas = candidatas.filter(
          (f) => semAcento(f.establishment?.name ?? "") === semAcento(unidade),
        );
      }
      /*
        A função tem o nome exato do cargo da planilha (decisão do Léo,
        12/11). Cargo que não casa deixava a pessoa entrar sem função, com um
        aviso fácil de não ver: agora a linha fica de fora até o nome bater.
      */
      if (candidatas.length === 0) {
        problems.push(
          unidade
            ? `Linha ${numero}: função "${nomeDaFuncao}" não existe na filial "${unidade}". Cadastre a função com esse nome em Operação ou corrija o cargo na planilha.`
            : `Linha ${numero}: função "${nomeDaFuncao}" não existe. Cadastre a função com esse nome em Operação ou corrija o cargo na planilha.`,
        );
        continue;
      } else if (candidatas.length > 1) {
        const unidades = [
          ...new Set(candidatas.map((f) => f.establishment?.name ?? "sem unidade")),
        ];
        problems.push(
          `Linha ${numero}: a função "${nomeDaFuncao}" existe em ${unidades.join(
            " e ",
          )}. Acrescente a coluna "filial" para dizer qual.`,
        );
        continue;
      } else {
        row.job_role_id = candidatas[0]!.id;
      }
    }
    /*
      O papel chegava só como código interno, e a explicação nem o
      mencionava: a planilha passa a aceitar "Supervisor" como aceita
      "Terceirizado". [B2-1-D]
    */
    if (row.org_role) {
      const codigo = rotulos.papeis[row.org_role.toUpperCase()]
        ? row.org_role.toUpperCase()
        : papeis.get(semAcento(row.org_role));
      if (!codigo) {
        problems.push(`Linha ${numero}: papel "${row.org_role}" desconhecido.`);
        delete row.org_role;
      } else {
        row.org_role = codigo;
      }
    }
    if (row.bond) {
      const codigo = rotulos.vinculos[row.bond.toUpperCase()]
        ? row.bond.toUpperCase()
        : vinculos.get(semAcento(row.bond));
      if (!codigo) {
        problems.push(`Linha ${numero}: vínculo "${row.bond}" desconhecido.`);
        delete row.bond;
      } else {
        row.bond = codigo;
      }
    }
    if (row.contractor_id) {
      const id = empresaPorNome.get(semAcento(row.contractor_id));
      if (!id) {
        problems.push(
          `Linha ${numero}: empresa contratada "${row.contractor_id}" não está cadastrada em Terceiros.`,
        );
        delete row.contractor_id;
      } else {
        row.contractor_id = id;
        if (!row.bond || row.bond === "EMPLOYEE") row.bond = "CONTRACTOR";
      }
    }
    /*
      Terceirizado sem empresa entrava calado, e na fiscalização o
      terceirizado aparece sem a empresa responsável por ele. [B3-1-B] [S1-R]
    */
    if (row.bond === "CONTRACTOR" && !row.contractor_id) {
      problems.push(
        `Linha ${numero}: "${row.name}" entra como Terceirizado sem empresa contratada. Preencha a coluna "empresa contratada" ou cadastre a empresa em Terceiros.`,
      );
    }
    if (row.payroll) {
      for (const k of DATAS_DA_FOLHA) {
        const v = row.payroll[k];
        if (v) row.payroll[k] = normalizarData(v);
      }
      /* "10/2026" → "2026-10". */
      const comp = /^(\d{1,2})\/(\d{4})$/.exec(row.payroll.competence ?? "");
      if (comp) row.payroll.competence = `${comp[2]}-${comp[1]!.padStart(2, "0")}`;
    }
    /* Data em número de série, d/m/aaaa ou aaaa/mm/dd, como o Excel grava. [PF-1] [C4-3] */
    if (row.admitted_at) row.admitted_at = normalizarData(row.admitted_at);
    if (row.birth_date) row.birth_date = normalizarData(row.birth_date);
    /* CPF gravado como número no Excel perde os zeros da frente. [PF-1] */
    if (row.tax_id && /^\d{9,10}$/.test(row.tax_id)) row.tax_id = row.tax_id.padStart(11, "0");
    const cpf = row.tax_id?.replace(/\D/g, "");
    if (cpf) {
      const antes = cpfVisto.get(cpf);
      if (antes !== undefined) {
        problems.push(`Linha ${numero}: CPF repetido na planilha (já está na linha ${antes}).`);
        continue;
      }
    }
    const chaveMatricula = row.registration
      ? `${row.establishment_id ?? "-"}:${codigoCanonico(row.registration)}`
      : null;
    if (chaveMatricula) {
      const antes = matriculaVista.get(chaveMatricula);
      if (antes !== undefined) {
        problems.push(
          `Linha ${numero}: matrícula ${row.registration} repetida na mesma filial (já está na linha ${antes}).`,
        );
        continue;
      }
    }
    if (cpf) cpfVisto.set(cpf, numero);
    if (chaveMatricula) matriculaVista.set(chaveMatricula, numero);
    rows.push(row);
    numeros.push(numero);
  }

  const aceitas = new Set(numeros);
  const porLinha = new Map<number, LinhaRecusada>();
  for (const problema of problems) {
    const m = /^Linha (\d+): ([\s\S]*)$/.exec(problema);
    if (!m) continue;
    const linha = Number(m[1]);
    if (aceitas.has(linha)) continue;
    const recusada = porLinha.get(linha) ?? { linha, nome: nomeDaLinha.get(linha) ?? "", motivos: [] };
    recusada.motivos.push(m[2]!);
    porLinha.set(linha, recusada);
  }
  const recusadas = [...porLinha.values()].sort((a, b) => a.linha - b.linha);

  return { rows, problems, recusadas, numeros, modelo: daFolha ? "folha" : "csv" };
}


/**
 * Lê o arquivo da planilha como texto.
 *
 * O Excel em português salva CSV em Windows-1252 quando não se escolhe "CSV
 * UTF-8": lido como UTF-8, "José" vira "Jos\uFFFD". Com BOM, é UTF-8 e pronto;
 * sem BOM, tenta UTF-8 e, se aparecer caractere de substituição, lê de novo
 * em Windows-1252. [B3-1-B]
 *
 * O `TextDecoder` já tira o BOM sozinho. Cortar mais um caractere, como se
 * fazia, comia a primeira letra do arquivo: "nome" virava "ome", e toda
 * linha saía "sem nome" — no próprio modelo baixado do portal e em todo
 * "CSV UTF-8" do Excel.
 */
export async function lerPlanilha(arquivo: Blob): Promise<string> {
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const temBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const comoUtf8 = new TextDecoder("utf-8").decode(bytes);
  if (temBom || !comoUtf8.includes("\uFFFD")) return comoUtf8;
  return new TextDecoder("windows-1252").decode(bytes);
}
