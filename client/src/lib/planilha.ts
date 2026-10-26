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
  bond?: string;
  org_role?: string;
  contractor_id?: string;
};

type LinhaLocal = LinhaDaPlanilha & { establishment?: string };

export type FuncaoDaEmpresa = {
  id: string;
  name: string;
  establishment?: { name: string } | null;
};

export type Lido = { rows: LinhaDaPlanilha[]; problems: string[] };

export type RotulosDaPlanilha = {
  /** código → rótulo, como ORG_ROLE_LABEL e WORKER_BOND_LABEL. */
  papeis: Record<string, string>;
  vinculos: Record<string, string>;
};

/** A mesma regra do servidor: o que não cabe num nome. [B2-1-L] */
const CPF_SOLTO = /\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}/;
const DATA_SOLTA = /\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/;

/** A unidade não vai para o servidor: serve para achar a função certa. [CB-6] */


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
  "unidade",
  "admissao",
  "vinculo",
  "empresa contratada",
  "papel",
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
  vinculo: "bond",
  papel: "org_role",
  /// Terceirizado sem empresa deixa a lacuna à mostra na ficha. [S1-R] [CB-8]
  "empresa contratada": "contractor_id",
  empresa: "contractor_id",
  contratada: "contractor_id",
  /// Desempata função de mesmo nome em duas unidades. [CB-6]
  unidade: "establishment",
  estabelecimento: "establishment",
};

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

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
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
 */
export function lerLinhas(
  texto: string,
  funcoes: FuncaoDaEmpresa[],
  empresas: { id: string; name: string }[],
  rotulos: RotulosDaPlanilha,
): Lido {
  const linhas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (linhas.length === 0) return { rows: [], problems: [] };

  const sep = separador(linhas[0]!);
  const cabecalho = linhas[0]!.split(sep).map((c) => semAcento(c));
  const temCabecalho = cabecalho.some((c) => c in COLUNAS);
  /*
    Coluna com cabeçalho que o portal não conhece era deixada de lado em
    silêncio: a empresa montava a planilha seguindo a tela e o dado não
    entrava, sem ninguém perceber. [B3-1-B]
  */
  const colunasIgnoradas = temCabecalho
    ? cabecalho.filter((c) => c && !(c in COLUNAS))
    : [];
  const campos = temCabecalho
    ? cabecalho.map((c) => COLUNAS[c] ?? null)
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

  const rows: LinhaDaPlanilha[] = [];
  const problems: string[] = [];

  if (colunasIgnoradas.length > 0) {
    problems.push(
      `Coluna não reconhecida: ${colunasIgnoradas
        .map((c) => `"${c}"`)
        .join(", ")}. O portal lê ${CABECALHO_OFICIAL.join(
        ", ",
      )} — baixe o modelo para usar os mesmos nomes.`,
    );
  }

  for (const [i, linha] of linhas.slice(temCabecalho ? 1 : 0).entries()) {
    /*
      A linha é numerada como no Excel: com cabeçalho, a primeira pessoa está
      na linha 2. Antes a prévia dizia "Linha 1" para ela, e quem conferia no
      Excel procurava no lugar errado. [S1-G]
    */
    const numero = temCabecalho ? i + 2 : i + 1;
    const celulas = linha.split(sep).map((c) => c.trim());
    const row: LinhaDaPlanilha = { name: "" };
    celulas.forEach((valor, coluna) => {
      const campo = campos[coluna];
      if (!campo || !valor) return;
      (row as Record<string, string>)[campo] = valor;
    });

    if (!row.name) {
      problems.push(`Linha ${numero}: sem nome.`);
      continue;
    }

    /*
      Linha copiada do Excel que perde as tabulações vira uma coluna só: o
      nome passava a ser a linha inteira e a prévia dava "Entra" para uma
      pessoa sem matrícula, sem CPF e sem função. A prévia existe para
      proteger. [B2-1-L]
    */
    if (temCabecalho && cabecalho.length > 1 && celulas.length === 1) {
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
    if (row.job_role_id) {
      const nomeDaFuncao = row.job_role_id;
      let candidatas = porNome.get(semAcento(nomeDaFuncao)) ?? [];
      const unidade = (row as LinhaLocal).establishment;
      if (unidade) {
        candidatas = candidatas.filter(
          (f) => semAcento(f.establishment?.name ?? "") === semAcento(unidade),
        );
      }
      if (candidatas.length === 0) {
        problems.push(
          unidade
            ? `Linha ${numero}: função "${nomeDaFuncao}" não existe na unidade "${unidade}".`
            : `Linha ${numero}: função "${nomeDaFuncao}" não existe.`,
        );
        delete row.job_role_id;
      } else if (candidatas.length > 1) {
        const unidades = [
          ...new Set(candidatas.map((f) => f.establishment?.name ?? "sem unidade")),
        ];
        problems.push(
          `Linha ${numero}: a função "${nomeDaFuncao}" existe em ${unidades.join(
            " e ",
          )}. Acrescente a coluna "unidade" para dizer qual.`,
        );
        delete row.job_role_id;
      } else {
        row.job_role_id = candidatas[0]!.id;
      }
    }
    delete (row as LinhaLocal).establishment;
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
    if (row.admitted_at && /^\d{2}\/\d{2}\/\d{4}$/.test(row.admitted_at)) {
      const [d, m, a] = row.admitted_at.split("/");
      row.admitted_at = `${a}-${m}-${d}`;
    }
    rows.push(row);
  }

  return { rows, problems };
}

