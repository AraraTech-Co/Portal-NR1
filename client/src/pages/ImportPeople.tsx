import { useEffect, useMemo, useState } from "react";
import {
  importPeople,
  WORKER_BOND_LABEL,
  type ImportReport,
  type ImportRow,
} from "@/api/people";
import { fetchJobRoles, type JobRole } from "@/api/operation";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import "@/components/data-table.css";
import "@/components/form.css";
import "./import-people.css";

const EXEMPLO = `nome;matricula;cpf;email;funcao;admissao;vinculo
Maria de Souza;1023;529.982.247-25;maria@empresa.com.br;Vendedor;2025-03-10;EMPLOYEE
João Pereira;1024;;;Vendedor;2025-04-01;CONTRACTOR`;

/** Cabeçalhos aceitos, com e sem acento, para a planilha colada. */
const COLUNAS: Record<string, keyof ImportRow> = {
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
  vinculo: "bond",
  papel: "org_role",
};

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function separador(linha: string): string {
  if (linha.includes("\t")) return "\t";
  if (linha.includes(";")) return ";";
  return ",";
}

type Parsed = { rows: ImportRow[]; problems: string[] };

/**
 * Lê a planilha colada. O vínculo e a função chegam por nome na planilha e
 * saem daqui como código e id — quem monta a planilha escreve "Vendedor",
 * não um uuid. [S1-A]
 */
function parse(texto: string, funcoes: JobRole[]): Parsed {
  const linhas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (linhas.length === 0) return { rows: [], problems: [] };

  const sep = separador(linhas[0]!);
  const cabecalho = linhas[0]!.split(sep).map((c) => semAcento(c));
  const temCabecalho = cabecalho.some((c) => c in COLUNAS);
  const campos = temCabecalho
    ? cabecalho.map((c) => COLUNAS[c] ?? null)
    : (["name", "registration", "tax_id", "email", "job_role_id", "admitted_at", "bond"] as (keyof ImportRow)[]);

  const porNome = new Map(funcoes.map((f) => [semAcento(f.name), f.id]));
  const vinculos = new Map(
    Object.entries(WORKER_BOND_LABEL).map(([codigo, rotulo]) => [semAcento(rotulo), codigo]),
  );

  const rows: ImportRow[] = [];
  const problems: string[] = [];

  for (const [i, linha] of linhas.slice(temCabecalho ? 1 : 0).entries()) {
    const numero = i + 1;
    const celulas = linha.split(sep).map((c) => c.trim());
    const row: ImportRow = { name: "" };
    celulas.forEach((valor, coluna) => {
      const campo = campos[coluna];
      if (!campo || !valor) return;
      (row as Record<string, string>)[campo] = valor;
    });

    if (!row.name) {
      problems.push(`Linha ${numero}: sem nome.`);
      continue;
    }
    if (row.job_role_id) {
      const id = porNome.get(semAcento(row.job_role_id));
      if (!id) {
        problems.push(`Linha ${numero}: função "${row.job_role_id}" não existe.`);
        delete row.job_role_id;
      } else {
        row.job_role_id = id;
      }
    }
    if (row.bond) {
      const codigo = WORKER_BOND_LABEL[row.bond.toUpperCase()]
        ? row.bond.toUpperCase()
        : vinculos.get(semAcento(row.bond));
      if (!codigo) {
        problems.push(`Linha ${numero}: vínculo "${row.bond}" desconhecido.`);
        delete row.bond;
      } else {
        row.bond = codigo;
      }
    }
    if (row.admitted_at && /^\d{2}\/\d{2}\/\d{4}$/.test(row.admitted_at)) {
      const [d, m, a] = row.admitted_at.split("/");
      row.admitted_at = `${a}-${m}-${d}`;
    }
    rows.push(row);
  }

  return { rows, problems };
}

function tone(status: string): "success" | "neutral" | "danger" {
  if (status === "created") return "success";
  if (status === "skipped") return "neutral";
  return "danger";
}

/**
 * Cadastro em massa: cola a planilha, confere a prévia, cadastra. As senhas
 * de primeiro acesso aparecem uma vez — o portal não as guarda em texto. [S1-A]
 */
export function ImportPeople() {
  const [texto, setTexto] = useState("");
  const [funcoes, setFuncoes] = useState<JobRole[]>([]);
  const [previa, setPrevia] = useState<ImportReport | null>(null);
  const [relatorio, setRelatorio] = useState<ImportReport | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    fetchJobRoles()
      .then((d) => setFuncoes(d.job_roles))
      .catch(() => setFuncoes([]));
  }, []);

  const lido = useMemo(() => parse(texto, funcoes), [texto, funcoes]);

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
      <p className="muted">
        Cole a planilha com uma pessoa por linha. Aceita ponto e vírgula,
        vírgula ou a colagem direta do Excel. Quem já está cadastrado é pulado,
        o que estiver errado volta com o motivo, e o resto entra.
      </p>

      <label className="form-field">
        Planilha
        <textarea
          className="import-sheet"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setPrevia(null);
            setRelatorio(null);
          }}
          rows={8}
          spellCheck={false}
          placeholder={EXEMPLO}
        />
        <span className="form-hint">
          Colunas: nome; matrícula; CPF; e-mail; função; admissão; vínculo.
          Só o nome é obrigatório. Vínculo:{" "}
          {Object.values(WORKER_BOND_LABEL).join(", ")}.
        </span>
      </label>

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
        {previa && previa.created > 0 && (
          <Button type="button" disabled={ocupado} onClick={() => void cadastrar()}>
            {ocupado ? "Cadastrando…" : `Cadastrar ${previa.created} pessoa(s)`}
          </Button>
        )}
      </div>

      {mostrado && (
        <div className="import-report">
          <p className="muted">
            {relatorio
              ? `${relatorio.created} cadastrada(s), ${relatorio.skipped} já existia(m), ${relatorio.errors} com erro.`
              : `Prévia: ${previa!.created} entrariam, ${previa!.skipped} já existem, ${previa!.errors} com erro. Nada foi gravado ainda.`}
          </p>
          {relatorio && relatorio.created > 0 && (
            <p className="import-warning">
              As senhas abaixo aparecem <strong>uma única vez</strong>. Entregue
              a cada pessoa — na primeira entrada o portal obriga a trocar.
            </p>
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
