import { useState } from "react";
import {
  importJobRoles,
  type LinhaDeFuncao,
  type ResultadoDaImportacaoDeFuncoes,
} from "@/api/operation";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { chaveDaFolha, lerPlanilha } from "@/lib/planilha";
import { gerarXlsx, lerXlsx, pareceXlsx } from "@/lib/xlsx";
import "@/components/data-table.css";
import "@/components/form.css";
import "./import-people.css";

/**
 * Cadastrar setores e funções por planilha, em lote (desenho de 13/11).
 *
 * A tela só lê o arquivo e mostra o que o servidor responde: a prévia e a
 * gravação são do servidor, que confere tudo de novo. Só cria — nunca
 * altera, move nem apaga setor ou função.
 */

const MODELO = [
  ["filial", "setor", "funcao", "cbo 2002", "cbo 94"],
  ["0682", "Loja", "CAIXA", "4211-25", ""],
];

/** Os nomes de coluna aceitos, pela chave sem acento e sem pontuação. */
const COLUNAS: Record<string, keyof Omit<LinhaDeFuncao, "line">> = {
  filial: "filial",
  "cod empresa": "filial",
  "codigo da folha": "filial",
  cnpj: "filial",
  setor: "setor",
  funcao: "funcao",
  cargo: "funcao",
  "cbo 2002": "cbo_2002",
  cbo2002: "cbo_2002",
  cbo: "cbo_2002",
  "cbo 94": "cbo_94",
  cbo94: "cbo_94",
};

const LOTE = 200;

const SITUACAO: Record<
  ResultadoDaImportacaoDeFuncoes["results"][number]["situacao"],
  { rotulo: string; gravado?: string; tom: "success" | "info" | "neutral" | "danger" }
> = {
  cria_setor_e_funcao: { rotulo: "Cria setor e função", gravado: "Setor e função criados", tom: "success" },
  cria_funcao: { rotulo: "Cria função", gravado: "Função criada", tom: "success" },
  ja_existe: { rotulo: "Já existe", tom: "neutral" },
  repetida: { rotulo: "Repetida", tom: "neutral" },
  erro: { rotulo: "Erro", tom: "danger" },
};

function baixarModelo() {
  const url = URL.createObjectURL(
    new Blob([gerarXlsx(MODELO, "Funções") as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "modelo-setores-e-funcoes.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** As linhas da planilha, numeradas como no Excel; ou o motivo de não ler. */
function lerLinhasDeFuncao(matriz: string[][]): { linhas: LinhaDeFuncao[] } | { erro: string } {
  const inicio = matriz.findIndex((l) => l.some((c) => c.trim() !== ""));
  if (inicio < 0) return { erro: "A planilha está vazia." };
  const campos = matriz[inicio]!.map((c) => COLUNAS[chaveDaFolha(c)] ?? null);
  if (!campos.includes("filial") || !campos.includes("setor") || !campos.includes("funcao")) {
    return { erro: "A planilha precisa das colunas filial, setor e função. Baixe o modelo para usar os mesmos nomes." };
  }
  const linhas: LinhaDeFuncao[] = [];
  for (const [i, celulas] of matriz.entries()) {
    if (i <= inicio || !celulas.some((c) => c.trim() !== "")) continue;
    const linha: LinhaDeFuncao = { line: i + 1, filial: "", setor: "", funcao: "" };
    celulas.forEach((valor, coluna) => {
      const campo = campos[coluna];
      if (campo) linha[campo] = valor.trim();
    });
    linhas.push(linha);
  }
  return linhas.length ? { linhas } : { erro: "A planilha não tem linhas depois do cabeçalho." };
}

async function enviar(linhas: LinhaDeFuncao[], previa: boolean): Promise<ResultadoDaImportacaoDeFuncoes> {
  const total: ResultadoDaImportacaoDeFuncoes = {
    dry_run: previa,
    rows: 0,
    criariam: 0,
    ja_existem: 0,
    repetidas: 0,
    erros: 0,
    setores_criados: 0,
    funcoes_criadas: 0,
    results: [],
  };
  for (let i = 0; i < linhas.length; i += LOTE) {
    const r = await importJobRoles(linhas.slice(i, i + LOTE), previa);
    total.rows += r.rows;
    total.criariam += r.criariam;
    total.ja_existem += r.ja_existem;
    total.repetidas += r.repetidas;
    total.erros += r.erros;
    total.setores_criados += r.setores_criados;
    total.funcoes_criadas += r.funcoes_criadas;
    total.results.push(...r.results);
  }
  return total;
}

export function ImportarFuncoes({ onDone }: { onDone: () => Promise<void> | void }) {
  const [linhas, setLinhas] = useState<LinhaDeFuncao[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [previa, setPrevia] = useState<ResultadoDaImportacaoDeFuncoes | null>(null);
  const [relatorio, setRelatorio] = useState<ResultadoDaImportacaoDeFuncoes | null>(null);
  const [ocupado, setOcupado] = useState(false);
  /* Trocar a chave limpa o campo de arquivo depois de gravar. */
  const [campoDoArquivo, setCampoDoArquivo] = useState(0);

  async function lerArquivo(arquivo: File | null) {
    setErro(null);
    setPrevia(null);
    setRelatorio(null);
    setLinhas([]);
    if (!arquivo) return;
    try {
      const bytes = new Uint8Array(await arquivo.arrayBuffer());
      let matriz: string[][];
      if (pareceXlsx(bytes)) {
        matriz = await lerXlsx(bytes);
      } else {
        const texto = await lerPlanilha(arquivo);
        const primeira = texto.split(/\r?\n/).find((l) => l.trim()) ?? "";
        const sep = primeira.includes("\t") ? "\t" : primeira.includes(";") ? ";" : ",";
        matriz = texto.split(/\r?\n/).map((l) => l.split(sep));
      }
      const lido = lerLinhasDeFuncao(matriz);
      if ("erro" in lido) setErro(lido.erro);
      else setLinhas(lido.linhas);
    } catch {
      setErro("Não foi possível ler o arquivo. Envie um .xlsx ou um CSV.");
    }
  }

  async function conferir() {
    setErro(null);
    setRelatorio(null);
    setOcupado(true);
    try {
      setPrevia(await enviar(linhas, true));
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao conferir");
    } finally {
      setOcupado(false);
    }
  }

  async function gravar() {
    setErro(null);
    setOcupado(true);
    try {
      const r = await enviar(linhas, false);
      setRelatorio(r);
      setPrevia(null);
      setLinhas([]);
      setCampoDoArquivo((n) => n + 1);
      await onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao gravar");
    } finally {
      setOcupado(false);
    }
  }

  const mostrado = relatorio ?? previa;

  return (
    <details className="form-section op-importar-funcoes">
      <summary>
        <strong>Cadastrar setores e funções por planilha</strong>
      </summary>
      <p className="muted">
        Uma linha por função: <strong>filial</strong> (código da folha, nome ou CNPJ),{" "}
        <strong>setor</strong>, <strong>função</strong> e, se tiver, <strong>CBO 2002</strong> e{" "}
        <strong>CBO 94</strong>. O setor que não existe é criado. A função que já existe na
        filial fica como está. Nada é alterado nem apagado.
      </p>
      <div className="form-actions">
        <Button type="button" variant="ghost" onClick={baixarModelo}>
          Baixar a planilha modelo
        </Button>
      </div>
      <label className="form-field">
        Arquivo da planilha (.xlsx ou CSV)
        <input
          key={campoDoArquivo}
          type="file"
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain"
          onChange={(e) => void lerArquivo(e.target.files?.[0] ?? null)}
          disabled={ocupado}
        />
      </label>
      {linhas.length > 0 && !mostrado && (
        <p className="muted">{linhas.length === 1 ? "1 linha lida" : `${linhas.length} linhas lidas`}</p>
      )}
      {erro && (
        <p className="form-error" role="alert">
          {erro}
        </p>
      )}
      <div className="form-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={ocupado || linhas.length === 0}
          onClick={() => void conferir()}
        >
          {ocupado && !previa ? "Conferindo…" : "Conferir antes de gravar"}
        </Button>
        {previa && previa.criariam > 0 && (
          <Button type="button" disabled={ocupado} onClick={() => void gravar()}>
            {ocupado ? "Gravando…" : `Cadastrar ${previa.criariam} função(ões)`}
          </Button>
        )}
      </div>

      {mostrado && (
        <div className="import-report">
          <p className="muted">
            {relatorio
              ? `${relatorio.funcoes_criadas} função(ões) e ${relatorio.setores_criados} setor(es) criados, ${relatorio.ja_existem} já existiam, ${relatorio.repetidas} repetidas, ${relatorio.erros} com erro.`
              : `Prévia: ${previa!.criariam} função(ões) seriam criadas, ${previa!.ja_existem} já existem, ${previa!.repetidas} repetidas, ${previa!.erros} com erro. Nada foi gravado ainda.`}
          </p>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Filial</th>
                  <th>Setor</th>
                  <th>Função</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {mostrado.results.map((r) => (
                  <tr key={r.line}>
                    <td className="import-line">{r.line}</td>
                    <td>{r.filial ?? <span className="muted">—</span>}</td>
                    <td>{r.setor || <span className="muted">—</span>}</td>
                    <td>{r.funcao || <span className="muted">—</span>}</td>
                    <td>
                      <Chip tone={SITUACAO[r.situacao].tom}>
                        {(relatorio && SITUACAO[r.situacao].gravado) || SITUACAO[r.situacao].rotulo}
                      </Chip>
                      {r.message && <div className="muted">{r.message}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </details>
  );
}
