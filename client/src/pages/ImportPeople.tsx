import { useEffect, useMemo, useState } from "react";
import {
  importPeople,
  WORKER_BOND_LABEL,
  type ImportReport,
} from "@/api/people";
import { fetchContractorList } from "@/api/contractors";
import { fetchEstablishments, fetchJobRoles, type JobRole } from "@/api/operation";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { ORG_ROLE_LABEL } from "@/lib/labels";
import "@/components/data-table.css";
import "@/components/form.css";
import "./import-people.css";
import {
  CABECALHO_DA_FOLHA,
  CABECALHO_OFICIAL,
  lerLinhas,
  lerPlanilha,
  lerTabela,
  type FilialDaEmpresa,
  type FuncaoDaEmpresa,
  type Lido,
} from "@/lib/planilha";
import { importarEmLotes } from "@/lib/importar-em-lotes";
import { PlanilhaIlegivel, gerarXlsx, lerXlsx, pareceOfficeProtegido, pareceXlsx } from "@/lib/xlsx";

const PAPEIS_DA_PLANILHA = Object.entries(ORG_ROLE_LABEL)
  .filter(([codigo]) => !["MASTER", "OWNER", "ADMIN", "FISCAL"].includes(codigo))
  .map(([, rotulo]) => rotulo);

function tone(status: string): "success" | "info" | "neutral" | "danger" {
  if (status === "created") return "success";
  /** Quem já estava no portal e teve a ficha completada. [CB-2] */
  if (status === "completed") return "info";
  if (status === "skipped") return "neutral";
  return "danger";
}

/**
 * O modelo da planilha, para quem monta no Excel.
 *
 * A tela falava em planilha e não oferecia uma: cada um montava de um jeito,
 * e descobria no erro o que o portal esperava.
 *
 * Vai SÓ com o cabeçalho: as duas linhas de exemplo usavam função e unidade
 * que não existem na empresa e, esquecidas na planilha, entravam como
 * pessoas. O exemplo ficou na explicação da tela. [B2-1-D]
 */
const MODELO_CSV = CABECALHO_OFICIAL.join(";");

function baixar(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * O modelo é a planilha de funcionários do sistema de folha, com as mesmas
 * colunas e na mesma ordem, como decidido pelo Leonardo em 12/11/2026. [PF-1]
 */
function baixarModelo() {
  baixar(
    new Blob([gerarXlsx([[...CABECALHO_DA_FOLHA]], "Funcionários") as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    "modelo-planilha-de-funcionarios.xlsx",
  );
}

/**
 * O CSV de antes continua: é o caminho de quem não está na folha
 * (terceirizado), de e-mail e de papel. [PF-1]
 *
 * O BOM é o que faz o Excel abrir os acentos certos; sem ele, "João" vira
 * "JoÃ£o" na planilha de quem recebe.
 */
function baixarModeloCsv() {
  baixar(
    new Blob([`\ufeff${MODELO_CSV}\r\n`], { type: "text/csv;charset=utf-8" }),
    "modelo-cadastro-de-pessoas.csv",
  );
}

/**
 * Cadastro em massa: cola a planilha, confere a prévia, cadastra. As contas
 * novas aguardam o primeiro acesso por conferência de dados — nenhuma senha
 * sai daqui. [S1-A] [C1-7]
 */
export function ImportPeople() {
  const [texto, setTexto] = useState("");
  /* A planilha .xlsx, já em células; o CSV continua como texto. [PF-1] */
  const [celulas, setCelulas] = useState<string[][] | null>(null);
  const [progresso, setProgresso] = useState<string | null>(null);
  /*
    O que o RH marcou para receber o valor da planilha, por linha do Excel.
    Nada muda sozinho em quem já existe. [PF-3]
  */
  const [aceitos, setAceitos] = useState<Record<number, string[]>>({});
  /*
    A colagem sai: o cadastro passa a ser pelo envio do arquivo da planilha
    modelo, como combinado com a empresa em 21/10/2026. Colar do Excel
    perdia separador e transformava a linha inteira em nome. [B3-1-B] [S1-G]
  */
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erroDoArquivo, setErroDoArquivo] = useState<string | null>(null);
  const [funcoes, setFuncoes] = useState<JobRole[]>([]);
  const [empresas, setEmpresas] = useState<{ id: string; name: string }[]>([]);
  /* A filial de cada linha, pelo nome ou pelo CNPJ. [C3-3] */
  const [filiais, setFiliais] = useState<FilialDaEmpresa[]>([]);
  const [previa, setPrevia] = useState<ImportReport | null>(null);
  const [relatorio, setRelatorio] = useState<ImportReport | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    fetchJobRoles()
      .then((d) => setFuncoes(d.job_roles))
      .catch(() => setFuncoes([]));
    fetchContractorList()
      .then((rows) => setEmpresas(rows.map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => setEmpresas([]));
    fetchEstablishments()
      .then((d) =>
        setFiliais(
          d.establishments.map((e) => ({
            id: e.id,
            name: e.name,
            taxId: e.taxId,
            payrollCode: e.payrollCode ?? null,
          })),
        ),
      )
      .catch(() => setFiliais([]));
  }, []);

  const lido: Lido = useMemo(() => {
    const rotulos = { papeis: ORG_ROLE_LABEL, vinculos: WORKER_BOND_LABEL };
    return celulas
      ? lerTabela(celulas, funcoes as FuncaoDaEmpresa[], empresas, rotulos, filiais)
      : lerLinhas(texto, funcoes as FuncaoDaEmpresa[], empresas, rotulos, filiais);
  }, [texto, celulas, funcoes, empresas, filiais]);

  /*
    O servidor aceita 200 linhas por envio; a folha com todas as lojas passa
    disso. Vai em lotes, um depois do outro, e o relatório soma tudo. [PF-1]
  */
  async function enviar(simulacao: boolean) {
    const verbo = simulacao ? "Conferindo" : "Gravando";
    const linhas = simulacao
      ? lido.rows
      : lido.rows.map((row, i) => {
          const marcados = aceitos[lido.numeros[i]!];
          return marcados?.length ? { ...row, aceitar: marcados } : row;
        });
    return importarEmLotes(
      linhas,
      lido.numeros,
      (lote) => importPeople(lote, simulacao),
      undefined,
      (feitas, total) =>
        setProgresso(total > 200 ? `${verbo}… ${feitas} de ${total} linhas` : null),
    );
  }

  async function conferir() {
    setErro(null);
    setRelatorio(null);
    setAceitos({});
    setOcupado(true);
    try {
      setPrevia(await enviar(true));
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao conferir");
    } finally {
      setOcupado(false);
      setProgresso(null);
    }
  }

  async function cadastrar() {
    setErro(null);
    setOcupado(true);
    try {
      const res = await enviar(false);
      setRelatorio(res);
      setPrevia(null);
      setAceitos({});
      setTexto("");
      setCelulas(null);
    } catch (err) {
      /*
        Os lotes que já foram ficam gravados. Enviar a mesma planilha de novo
        não duplica ninguém: quem já entrou aparece como "sem nada a mudar".
      */
      setErro(
        `${err instanceof Error ? err.message : "Falha ao cadastrar"}. Parte das linhas pode já ter sido gravada: envie a mesma planilha de novo para terminar — quem já entrou não é cadastrado outra vez.`,
      );
    } finally {
      setOcupado(false);
      setProgresso(null);
    }
  }

  const mostrado = relatorio ?? previa;
  const marcados = Object.values(aceitos).reduce((t, a) => t + a.length, 0);
  const comDiferenca = previa?.results.filter((r) => r.divergences?.length).length ?? 0;
  function marcar(linha: number, campo: string, sim: boolean) {
    setAceitos((a) => {
      const atual = new Set(a[linha] ?? []);
      if (sim) atual.add(campo);
      else atual.delete(campo);
      return { ...a, [linha]: [...atual] };
    });
  }

  return (
    <section className="form-section">
      <h2>Cadastrar várias pessoas</h2>
      {/*
        O texto dizia que quem já está cadastrado é pulado, e a decisão CB-2
        mudou isso: a planilha completa o que está em branco. A tela
        contradizia o que o portal faz. [CB-51]
      */}
      <p className="muted">
        Envie a planilha de funcionários do sistema de folha (.xlsx), como ela
        sai, ou monte uma no modelo. Quem já está no portal tem a ficha{" "}
        <strong>completada</strong> com o que estiver em branco — nada é
        sobrescrito. O que estiver errado volta com o motivo, e o resto entra.
      </p>

      {/* Sem modelo, cada um montava a planilha de um jeito. [B2-1-D] */}
      <div className="form-actions">
        <Button type="button" variant="ghost" onClick={baixarModelo}>
          Baixar a planilha modelo
        </Button>
        <Button type="button" variant="ghost" onClick={baixarModeloCsv}>
          Outro formato: CSV (terceirizado, e-mail ou papel)
        </Button>
      </div>

      <label className="form-field">
        Arquivo da planilha
        <input
          type="file"
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain"
          onChange={async (e) => {
            const f = e.target.files?.[0] ?? null;
            setArquivo(f);
            setPrevia(null);
            setRelatorio(null);
            setErroDoArquivo(null);
            setAceitos({});
            setTexto("");
            setCelulas(null);
            if (!f) return;
            try {
              const bytes = new Uint8Array(await f.arrayBuffer());
              if (pareceXlsx(bytes)) setCelulas(await lerXlsx(bytes));
              else if (pareceOfficeProtegido(bytes))
                throw new PlanilhaIlegivel(
                  "Este arquivo está protegido por senha ou é do Excel antigo (.xls). Salve como .xlsx sem senha.",
                );
              else setTexto(await lerPlanilha(f));
            } catch (err) {
              setErroDoArquivo(
                err instanceof PlanilhaIlegivel
                  ? err.message
                  : "Não consegui ler este arquivo. Envie a planilha .xlsx da folha ou o CSV do modelo.",
              );
            }
          }}
        />
        <span className="form-hint">
          {arquivo ? `${arquivo.name} — ` : ""}
          <strong>Planilha da folha (.xlsx):</strong> a filial sai do{" "}
          <strong>Cód. Empresa</strong>, que tem de ser o código da folha da
          filial em Operação → Estabelecimentos; a matrícula sai do Cód. Func.
          e a função, do Cargo, com o nome exato da função cadastrada na
          filial. Todos entram como Empregado e Colaborador; o salário não é
          lido.
          <br />
          <strong>CSV:</strong> colunas {CABECALHO_OFICIAL.join("; ")}.{" "}
          {filiais.length > 1 ? (
            <>
              Obrigatórios: o nome e a <strong>filial</strong>, porque a empresa
              tem mais de uma.
            </>
          ) : (
            "Só o nome é obrigatório."
          )}{" "}
          {/* A filial separa a matrícula 153 da loja da 153 da AG. [C3-3] */}
          Filial: o nome ou o CNPJ do estabelecimento, como cadastrado em
          Operação → Estabelecimentos. No Excel, salve com{" "}
          <strong>Salvar como → CSV UTF-8</strong>. Exemplo de linha: Maria de
          Souza;1023;529.982.247-25;maria@empresa.com.br;Torneiro;
          {filiais[0]?.name ?? "Matriz"};10/03/2025;Empregado;;Colaborador
          <br />
          Vínculo: {Object.values(WORKER_BOND_LABEL).join(", ")}. A empresa
          precisa estar cadastrada em Terceiros.
          <br />
          {/* A coluna "papel" existia e a explicação não a mencionava. [B2-1-D] */}
          Papel: {PAPEIS_DA_PLANILHA.join(", ")}. Em branco, entra como
          Colaborador. O fiscal não entra por aqui: o acesso dele tem prazo,
          definido ao aprovar o pedido de entrada.
          <br />
          Datas em DD/MM/AAAA ou AAAA-MM-DD.
        </span>
      </label>

      {erroDoArquivo && (
        <p className="form-error" role="alert">
          {erroDoArquivo}
        </p>
      )}

      {lido.rows.length > 0 && (
        <p className="muted">
          {lido.modelo === "folha" ? "Planilha da folha · " : ""}
          {lido.rows.length === 1 ? "1 linha lida" : `${lido.rows.length} linhas lidas`}
          {lido.problems.length > 0 && ` · ${lido.problems.length} com problema`}
        </p>
      )}
      {lido.problems.length > 0 && (
        <ul className="import-problems">
          {lido.problems.slice(0, 10).map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {erro && (
        <p className="form-error" role="alert">
          {erro}
        </p>
      )}
      {progresso && (
        <p className="muted" role="status">
          {progresso}
        </p>
      )}

      <div className="form-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={ocupado || lido.rows.length === 0}
          onClick={() => void conferir()}
        >
          {ocupado && !relatorio ? "Conferindo…" : "Conferir antes de cadastrar"}
        </Button>
        {/* Agora a planilha também completa quem já existe: o botão não pode
            sumir quando só há fichas a completar. [CB-2] */}
        {previa && previa.created + previa.completed + marcados > 0 && (
          <Button type="button" disabled={ocupado} onClick={() => void cadastrar()}>
            {ocupado
              ? "Gravando…"
              : [
                  previa.created > 0 ? `cadastrar ${previa.created} pessoa(s)` : null,
                  previa.completed > 0 ? `completar ${previa.completed} ficha(s)` : null,
                  marcados > 0 ? `aplicar ${marcados} mudança(s) marcada(s)` : null,
                ]
                  .filter(Boolean)
                  .join(", ")
                  .replace(/, ([^,]*)$/, " e $1")
                  .replace(/^./, (c) => c.toUpperCase())}
          </Button>
        )}
      </div>

      {mostrado && (
        <div className="import-report">
          <p className="muted">
            {relatorio
              ? `${relatorio.created} cadastrada(s), ${relatorio.completed} ficha(s) completada(s), ${relatorio.skipped} sem nada a mudar, ${relatorio.errors} com erro.`
              : `Prévia: ${previa!.created} entrariam, ${previa!.completed} teriam a ficha completada, ${previa!.skipped} ficariam como estão, ${previa!.errors} com erro. Nada foi gravado ainda.`}
          </p>
          {previa && comDiferenca > 0 && (
            <p className="import-warning">
              {comDiferenca === 1 ? "1 pessoa já cadastrada" : `${comDiferenca} pessoas já cadastradas`} com
              dados diferentes do portal. Nada disso muda sozinho: marque, linha a linha, o que deve
              receber o valor da planilha. Matrícula e CPF nunca são trocados pela planilha.
            </p>
          )}
          {/* Nenhuma senha sai da planilha: a pessoa cria a própria no
              primeiro acesso, conferindo matrícula, CPF e nascimento. [C1-7] */}
          {relatorio && relatorio.created > 0 && (
            <p className="import-warning">
              As contas novas aguardam o primeiro acesso: cada pessoa abre o
              portal, toca em <strong>Primeiro acesso</strong> e informa
              matrícula, CPF e data de nascimento para criar a própria senha.
              Nenhuma senha foi gerada. O prazo é de 30 dias; quem ficar sem
              matrícula, CPF ou nascimento na ficha não consegue entrar sozinho.
            </p>
          )}
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nome</th>
                  <th>Filial</th>
                  <th>Situação</th>
                  <th>Login</th>
                </tr>
              </thead>
              <tbody>
                {mostrado.results.map((r) => (
                  <tr key={r.line}>
                    <td className="import-line">{r.line}</td>
                    <td>{r.name || <span className="muted">—</span>}</td>
                    <td>{r.establishment?.name ?? <span className="muted">—</span>}</td>
                    <td>
                      <Chip tone={tone(r.status)}>
                        {r.status === "created"
                          ? relatorio
                            ? "Cadastrada"
                            : "Entra"
                          : r.status === "completed"
                            ? relatorio
                              ? "Ficha completada"
                              : "Completa a ficha"
                            : r.status === "skipped"
                              ? "Já existe"
                              : "Erro"}
                      </Chip>
                      {r.message && <div className="muted">{r.message}</div>}
                      {r.divergences?.map((d) =>
                        previa ? (
                          <label key={d.campo} className="import-divergence">
                            <input
                              type="checkbox"
                              checked={(aceitos[r.line] ?? []).includes(d.campo)}
                              onChange={(e) => marcar(r.line, d.campo, e.target.checked)}
                              aria-label={`Usar o da planilha: ${d.rotulo} de ${r.name}`}
                            />
                            <span>
                              <strong>{d.rotulo}</strong>: no portal “{d.portal}”, na planilha “{d.planilha}”
                            </span>
                          </label>
                        ) : (
                          <div key={d.campo} className="muted import-divergence">
                            Ficou como estava — {d.rotulo}: no portal “{d.portal}”, na planilha “{d.planilha}”
                          </div>
                        ),
                      )}
                    </td>
                    <td>{r.login ?? <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
