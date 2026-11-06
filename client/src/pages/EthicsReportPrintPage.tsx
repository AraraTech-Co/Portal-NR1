import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchEthicsReportExport } from "@/api/ethics";
import { Button } from "@/components/Button";
import { LoadingState } from "@/components/LoadingState";
import {
  DEADLINE_SITUATION_LABEL,
  formatInstant,
  REPORT_CATEGORY_LABEL,
  REPORT_SEVERITY_LABEL,
  REPORT_STATUS_LABEL,
} from "@/lib/labels";
import "./document-view.css";
import "./ethics-print.css";

type Dados = Awaited<ReturnType<typeof fetchEthicsReportExport>>;

/**
 * O PDF de uma denúncia. Nenhum identificador de quem relatou sai em campo
 * estruturado — a identificada sai como "Identificada (consultar no
 * portal)" —, e quem escreveu pelo comitê sai como "Comitê". O texto livre
 * vai como foi escrito e pode conter nomes: a tela avisa, e o portal não
 * promete tirá-los. A exportação fica na trilha. [C1-6]
 */
export function EthicsReportPrintPage() {
  const { id = "" } = useParams();
  const [dados, setDados] = useState<Dados | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEthicsReportExport(id)
      .then(setDados)
      .catch((err) => setError(err instanceof Error ? err.message : "Falha ao gerar"));
  }, [id]);

  const voltar = `/comite/${encodeURIComponent(id)}`;
  if (error) {
    return (
      <div className="doc-view">
        <p className="page-error" role="alert">
          {error}
        </p>
        <Link to="/comite">← Relatos do comitê</Link>
      </div>
    );
  }
  if (!dados) return <LoadingState label="Montando o PDF…" />;
  const r = dados.report;

  return (
    <div className="doc-view ethics-print">
      <div className="doc-toolbar">
        <Link to={voltar} className="doc-back">
          ← Voltar ao relato
        </Link>
        <Button type="button" onClick={() => window.print()}>
          Imprimir ou salvar em PDF
        </Button>
      </div>
      <p className="ethics-print-warning" role="note">
        O relato e as mensagens saem como foram escritos e podem conter nomes ou
        outros dados pessoais. O portal não tira esses dados do texto.
      </p>

      <article className="doc-paper">
        <header className="doc-header">
          <p className="doc-kicker">{dados.organization.name} · Canal de denúncia</p>
          <h1>Denúncia {r.protocol}</h1>
          <dl className="doc-meta">
            <div>
              <dt>Recebida em</dt>
              <dd>{formatInstant(r.createdAt)}</dd>
            </div>
            <div>
              <dt>Unidade</dt>
              <dd>{r.establishment ?? "—"}</dd>
            </div>
            <div>
              <dt>Categoria</dt>
              <dd>{REPORT_CATEGORY_LABEL[r.category] ?? r.category}</dd>
            </div>
            <div>
              <dt>Situação</dt>
              <dd>{REPORT_STATUS_LABEL[r.status] ?? r.status}</dd>
            </div>
            <div>
              <dt>Quem relatou</dt>
              <dd>{r.reporter}</dd>
            </div>
            <div>
              <dt>Gerado em</dt>
              <dd>
                {formatInstant(dados.generated_at)} por {dados.generated_by.name || "—"}
              </dd>
            </div>
          </dl>
        </header>

        <section>
          <h2>Gravidade</h2>
          <p>
            {REPORT_SEVERITY_LABEL[r.severity] ?? r.severity}
            {r.severitySource === "COMMITTEE" ? ", ajustada pelo comitê" : ", pela categoria"}
          </p>
          {r.severityChanges.length > 0 && (
            <ul className="ethics-print-messages">
              {r.severityChanges.map((c, i) => (
                <li key={i}>
                  <strong>
                    {REPORT_SEVERITY_LABEL[c.fromSeverity]} → {REPORT_SEVERITY_LABEL[c.toSeverity]}
                  </strong>{" "}
                  em {formatInstant(c.at)} · {c.by}
                  <p className="ethics-print-text">{c.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2>Prazo da primeira providência</h2>
          <p>
            {DEADLINE_SITUATION_LABEL[r.deadline_situation] ?? r.deadline_situation} · vence{" "}
            {formatInstant(r.dueAt)}
            {r.firstActionAt ? ` · primeira providência em ${formatInstant(r.firstActionAt)}` : ""}
          </p>
        </section>

        <section>
          <h2>Relato</h2>
          <p className="ethics-print-text">{r.description}</p>
        </section>

        <section>
          <h2>Mensagens</h2>
          {r.messages.length === 0 ? (
            <p className="doc-empty">Nenhuma mensagem.</p>
          ) : (
            <ul className="ethics-print-messages">
              {r.messages.map((m, i) => (
                <li key={i}>
                  <strong>{m.author}</strong> · {formatInstant(m.createdAt)}
                  <p className="ethics-print-text">{m.body}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2>Quem a denúncia envolve</h2>
          <p>{r.cited.length ? r.cited.join(", ") : "Ninguém marcado pelo comitê."}</p>
        </section>

        <section>
          <h2>Encerramento</h2>
          {r.resolvedAt ? (
            <>
              <p>Em {formatInstant(r.resolvedAt)}</p>
              <p className="ethics-print-text">{r.resolutionNote ?? "—"}</p>
            </>
          ) : (
            <p className="doc-empty">Ainda não encerrada.</p>
          )}
        </section>

        <section>
          <h2>Ciência de quem relatou</h2>
          {r.reporterAckAt ? (
            <>
              <p>Em {formatInstant(r.reporterAckAt)}</p>
              {r.reporterAckComment && <p className="ethics-print-text">{r.reporterAckComment}</p>}
            </>
          ) : (
            <p className="doc-empty">Sem ciência.</p>
          )}
        </section>
        <p className="ethics-print-footer">Documento confidencial: canal de denúncia</p>
      </article>
    </div>
  );
}
