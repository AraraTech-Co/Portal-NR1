import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchEthicsListExport } from "@/api/ethics";
import { Button } from "@/components/Button";
import { LoadingState } from "@/components/LoadingState";
import { describeEthicsFilters, filtersQuery } from "@/lib/ethics-filters";
import {
  DEADLINE_SITUATION_LABEL,
  formatDay,
  formatInstant,
  REPORT_CATEGORY_LABEL,
  REPORT_SEVERITY_LABEL,
  REPORT_STATUS_LABEL,
} from "@/lib/labels";
import "./document-view.css";
import "./ethics-print.css";

type Dados = Awaited<ReturnType<typeof fetchEthicsListExport>>;

function Totais({ titulo, dados, rotulos }: { titulo: string; dados: Record<string, number>; rotulos: Record<string, string> }) {
  const itens = Object.entries(dados);
  return (
    <div>
      <dt>{titulo}</dt>
      <dd>
        <ul>
          {itens.length === 0 && <li>—</li>}
          {itens.map(([k, n]) => (
            <li key={k}>
              {rotulos[k] ?? k}: <strong>{n}</strong>
            </li>
          ))}
        </ul>
      </dd>
    </div>
  );
}

/**
 * O PDF da lista do comitê: o que está filtrado, sem paginação, sem o texto
 * das denúncias e sem as mensagens. A exportação fica na trilha. [C1-6]
 */
export function EthicsListPrintPage() {
  const [params] = useSearchParams();
  const query = filtersQuery(params);
  const [dados, setDados] = useState<Dados | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEthicsListExport(query)
      .then(setDados)
      .catch((err) => setError(err instanceof Error ? err.message : "Falha ao gerar"));
  }, [query]);

  const voltar = `/comite${query ? `?${query}` : ""}`;

  if (error) {
    return (
      <div className="doc-view">
        <p className="page-error" role="alert">
          {error}
        </p>
        <Link to={voltar}>← Voltar à lista</Link>
      </div>
    );
  }
  if (!dados) return <LoadingState label="Montando o relatório…" />;

  const filtros = describeEthicsFilters(dados.filters, dados.establishment_name);

  return (
    <div className="doc-view ethics-print">
      <div className="doc-toolbar">
        <Link to={voltar} className="doc-back">
          ← Voltar à lista
        </Link>
        <Button type="button" onClick={() => window.print()}>
          Imprimir ou salvar em PDF
        </Button>
      </div>

      <article className="doc-paper">
        <header className="doc-header">
          <p className="doc-kicker">{dados.organization.name}</p>
          <h1>Canal de denúncia: relatório</h1>
          <dl className="doc-meta">
            <div>
              <dt>Filtros</dt>
              <dd>{filtros.length ? filtros.join(" · ") : "Nenhum: todas as denúncias que você acessa"}</dd>
            </div>
            <div>
              <dt>Gerado em</dt>
              <dd>{formatInstant(dados.generated_at)}</dd>
            </div>
            <div>
              <dt>Gerado por</dt>
              <dd>{dados.generated_by.name || "—"}</dd>
            </div>
            <div>
              <dt>Denúncias</dt>
              <dd>{dados.total}</dd>
            </div>
          </dl>
        </header>

        <dl className="ethics-print-totals">
          <Totais titulo="Por situação" dados={dados.totals.by_status} rotulos={REPORT_STATUS_LABEL} />
          <Totais titulo="Por gravidade" dados={dados.totals.by_severity} rotulos={REPORT_SEVERITY_LABEL} />
          <Totais titulo="Por prazo" dados={dados.totals.by_situation} rotulos={DEADLINE_SITUATION_LABEL} />
        </dl>

        {dados.rows.length === 0 ? (
          <p className="doc-empty">Nenhuma denúncia com estes filtros.</p>
        ) : (
          <div className="ethics-print-scroll">
          <table className="ethics-print-table">
            <thead>
              <tr>
                <th>Protocolo</th>
                <th>Recebida em</th>
                <th>Unidade</th>
                <th>Categoria</th>
                <th>Gravidade</th>
                <th>Situação</th>
                <th>Prazo</th>
                <th>Ciência</th>
              </tr>
            </thead>
            <tbody>
              {dados.rows.map((r) => (
                <tr key={r.protocol}>
                  <td>
                    <strong>{r.protocol}</strong>
                  </td>
                  <td className="ethics-print-date">{formatInstant(r.createdAt).replace(" às ", " ")}</td>
                  <td>{r.establishment ?? "—"}</td>
                  <td>{REPORT_CATEGORY_LABEL[r.category] ?? r.category}</td>
                  <td>
                    {REPORT_SEVERITY_LABEL[r.severity] ?? r.severity}
                    {r.severitySource === "COMMITTEE" ? " (ajustada pelo comitê)" : ""}
                  </td>
                  <td>{REPORT_STATUS_LABEL[r.status] ?? r.status}</td>
                  <td>
                    {DEADLINE_SITUATION_LABEL[r.deadline_situation] ?? r.deadline_situation}
                    <br />
                    <span className="muted ethics-print-date">vence {formatInstant(r.dueAt).replace(" às ", " ")}</span>
                  </td>
                  <td className="ethics-print-date">{r.reporterAckAt ? formatDay(r.reporterAckAt) : "Sem ciência"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        <p className="ethics-print-footer">Documento confidencial: canal de denúncia</p>
      </article>
    </div>
  );
}
