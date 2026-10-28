import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  importPeople,
  WORKER_BOND_LABEL,
  type ImportReport,
} from "@/api/people";
import { fetchContractorList } from "@/api/contractors";
import { fetchJobRoles, type JobRole } from "@/api/operation";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { ORG_ROLE_LABEL } from "@/lib/labels";
import { useAuth } from "@/auth/AuthContext";
import "@/components/data-table.css";
import "@/components/form.css";
import "./import-people.css";
import {
  CABECALHO_OFICIAL,
  lerLinhas,
  lerPlanilha,
  type FuncaoDaEmpresa,
} from "@/lib/planilha";

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
const MODELO = CABECALHO_OFICIAL.join(";");

function baixarModelo() {
  /*
    O BOM é o que faz o Excel abrir os acentos certos; sem ele, "João" vira
    "JoÃ£o" na planilha de quem recebe.
  */
  const blob = new Blob([`\ufeff${MODELO}\r\n`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "modelo-cadastro-de-pessoas.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Só as fichas vão ao papel: a marca no body diz à folha de estilo o que
 * esconder, e sai no fim da impressão. [B2-1-E]
 */
function imprimirFichas() {
  document.body.classList.add("imprimindo-fichas");
  window.addEventListener(
    "afterprint",
    () => document.body.classList.remove("imprimindo-fichas"),
    { once: true },
  );
  window.print();
}

/**
 * Cadastro em massa: cola a planilha, confere a prévia, cadastra. As senhas
 * de primeiro acesso aparecem uma vez — o portal não as guarda em texto. [S1-A]
 */
export function ImportPeople() {
  /* A ficha não dizia de que empresa é nem onde entrar. [B2-1-E] */
  const { user } = useAuth();
  const empresa = user?.organization.name ?? null;
  const [texto, setTexto] = useState("");
  /*
    A colagem sai: o cadastro passa a ser pelo envio do arquivo da planilha
    modelo, como combinado com a empresa em 21/10/2026. Colar do Excel
    perdia separador e transformava a linha inteira em nome. [B3-1-B] [S1-G]
  */
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erroDoArquivo, setErroDoArquivo] = useState<string | null>(null);
  const [funcoes, setFuncoes] = useState<JobRole[]>([]);
  const [empresas, setEmpresas] = useState<{ id: string; name: string }[]>([]);
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
  }, []);

  const lido = useMemo(
    () =>
      lerLinhas(texto, funcoes as FuncaoDaEmpresa[], empresas, {
        papeis: ORG_ROLE_LABEL,
        vinculos: WORKER_BOND_LABEL,
      }),
    [texto, funcoes, empresas],
  );

  async function conferir() {
    setErro(null);
    setRelatorio(null);
    setOcupado(true);
    try {
      setPrevia(await importPeople(lido.rows, true));
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao conferir");
    } finally {
      setOcupado(false);
    }
  }

  async function cadastrar() {
    setErro(null);
    setOcupado(true);
    try {
      const res = await importPeople(lido.rows, false);
      setRelatorio(res);
      setPrevia(null);
      setTexto("");
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao cadastrar");
    } finally {
      setOcupado(false);
    }
  }

  const mostrado = relatorio ?? previa;

  return (
    <section className="form-section">
      <h2>Cadastrar várias pessoas</h2>
      {/*
        O texto dizia que quem já está cadastrado é pulado, e a decisão CB-2
        mudou isso: a planilha completa o que está em branco. A tela
        contradizia o que o portal faz. [CB-51]
      */}
      <p className="muted">
        Baixe o modelo, preencha uma pessoa por linha e envie o arquivo. Quem
        já está no portal tem a ficha <strong>completada</strong> com o que
        estiver em branco — nada é sobrescrito. O que estiver errado volta com
        o motivo, e o resto entra.
      </p>

      {/* Sem modelo, cada um montava a planilha de um jeito. [B2-1-D] */}
      <div className="form-actions">
        <Button type="button" variant="ghost" onClick={baixarModelo}>
          Baixar a planilha modelo
        </Button>
      </div>

      <label className="form-field">
        Arquivo da planilha
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={async (e) => {
            const f = e.target.files?.[0] ?? null;
            setArquivo(f);
            setPrevia(null);
            setRelatorio(null);
            setErroDoArquivo(null);
            if (!f) {
              setTexto("");
              return;
            }
            try {
              setTexto(await lerPlanilha(f));
            } catch {
              setTexto("");
              setErroDoArquivo("Não consegui ler este arquivo. Envie o CSV do modelo.");
            }
          }}
        />
        <span className="form-hint">
          {arquivo ? `${arquivo.name} — ` : ""}
          Colunas: {CABECALHO_OFICIAL.join("; ")}. Só o nome é obrigatório.
          <br />
          No Excel, salve com <strong>Salvar como → CSV UTF-8</strong>; no
          Excel em português o separador sai como ponto e vírgula, que é o do
          modelo.
          <br />
          Exemplo de linha: Maria de Souza;1023;529.982.247-25;
          maria@empresa.com.br;Torneiro;Matriz;10/03/2025;Empregado;;Colaborador
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
        {previa && previa.created + previa.completed > 0 && (
          <Button type="button" disabled={ocupado} onClick={() => void cadastrar()}>
            {ocupado
              ? "Gravando…"
              : previa.created > 0 && previa.completed > 0
                ? `Cadastrar ${previa.created} e completar ${previa.completed}`
                : previa.created > 0
                  ? `Cadastrar ${previa.created} pessoa(s)`
                  : `Completar ${previa.completed} ficha(s)`}
          </Button>
        )}
      </div>

      {/*
        As fichas: existem para o papel, e só aparecem na impressão. [B2-1-E]

        Vão para fora da tela, direto no `body`: a impressão escondia o resto
        com `visibility: hidden`, e o espaço dele continuava contando — duas
        fichas saíam com 12 páginas, 11 em branco. Como filhas do `body`, o
        resto sai do fluxo de verdade. [B3-1-D]
      */}
      {relatorio &&
        createPortal(
          <div className="import-slips">
            {relatorio.results
              .filter((r) => r.temporary_password)
              .map((r) => (
                <section key={`ficha-${r.line}`} className="import-slip">
                  <h2>Primeiro acesso ao Portal NR-1</h2>
                  {/* Quem recebe a ficha não sabia onde entrar. [B2-1-E] */}
                  <p className="import-slip-onde">
                    {empresa ?? "Portal NR-1"}
                    <br />
                    {window.location.origin}
                  </p>
                  <dl>
                    <div>
                      <dt>Nome</dt>
                      <dd>{r.name}</dd>
                    </div>
                    <div>
                      <dt>Entrar com</dt>
                      <dd>{r.login}</dd>
                    </div>
                    <div>
                      <dt>Senha provisória</dt>
                      <dd>
                        <code>{r.temporary_password}</code>
                      </dd>
                    </div>
                  </dl>
                  <p>
                    Na primeira entrada o portal pede para trocar a senha.
                    Depois disso, esta folha não serve para mais nada — rasgue
                    e jogue fora.
                  </p>
                </section>
              ))}
          </div>,
          document.body,
        )}

      {mostrado && (
        <div className="import-report">
          <p className="muted">
            {relatorio
              ? `${relatorio.created} cadastrada(s), ${relatorio.completed} ficha(s) completada(s), ${relatorio.skipped} sem nada a mudar, ${relatorio.errors} com erro.`
              : `Prévia: ${previa!.created} entrariam, ${previa!.completed} teriam a ficha completada, ${previa!.skipped} ficariam como estão, ${previa!.errors} com erro. Nada foi gravado ainda.`}
          </p>
          {relatorio && relatorio.created > 0 && (
            <>
              <p className="import-warning">
                As senhas abaixo aparecem <strong>uma única vez</strong>. Entregue
                a cada pessoa — na primeira entrada o portal obriga a trocar.
              </p>
              {/*
                Copiar senha por senha para entregar a 30 pessoas era o
                gargalo de um cadastro que leva um minuto. Sai uma ficha por
                pessoa, para recortar e entregar. [B2-1-E]
              */}
              <div className="form-actions">
                <Button type="button" variant="secondary" onClick={imprimirFichas}>
                  Imprimir as fichas de primeiro acesso
                </Button>
              </div>
              {/*
                As senhas provisórias aparecem uma vez só: guardá-las para
                reimprimir depois seria guardar senha em claro. Quem fechar a
                tela antes de imprimir tem um caminho, e a tela passa a
                dizê-lo. [B2-1-E]
              */}
              <p className="muted">
                Imprima agora: as senhas provisórias aparecem uma vez e não
                ficam guardadas. Se perder a folha, use{" "}
                <strong>Redefinir senha</strong> em Pessoas e acessos — sai uma
                senha provisória nova para entregar.
              </p>
            </>
          )}
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nome</th>
                  <th>Situação</th>
                  <th>Login</th>
                  {relatorio && <th>Senha de primeiro acesso</th>}
                </tr>
              </thead>
              <tbody>
                {mostrado.results.map((r) => (
                  <tr key={r.line}>
                    <td className="import-line">{r.line}</td>
                    <td>{r.name || <span className="muted">—</span>}</td>
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
                    </td>
                    <td>{r.login ?? <span className="muted">—</span>}</td>
                    {relatorio && (
                      <td>
                        {r.temporary_password ? (
                          <code className="import-password">{r.temporary_password}</code>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    )}
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
