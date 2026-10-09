import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fetchPgrDocument,
  PGR_TYPE_LABEL,
  type ActionPlanContent,
  type CriteriaContent,
  type InventoryContent,
  type PgrDocumentFull,
} from "@/api/documents";
import { Button } from "@/components/Button";
import { LoadingState } from "@/components/LoadingState";
import {
  ACTION_PRIORITY_LABEL,
  ACTION_STATUS_LABEL,
  CONTROL_STATUS_LABEL,
  CONTROL_TYPE_LABEL,
  formatDay,
  HAZARD_CATEGORY_LABEL,
  RISK_LEVEL_LABEL,
} from "@/lib/labels";
import "./document-view.css";

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function formatCnpj(value: string | null): string | null {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length !== 14) return value;
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

function label(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return "—";
  return map[key] ?? key;
}

function Inventory({ content }: { content: InventoryContent }) {
  if (content.items.length === 0) {
    return <p className="doc-empty">Nenhum perigo registrado na data da emissão.</p>;
  }
  return (
    <div className="doc-items">
      {content.items.map((h, i) => (
        <section key={h.hazard_id} className="doc-item">
          <h3>
            <span className="doc-item-index">{i + 1}.</span> {h.description}
          </h3>
          <dl className="doc-facts">
            <div>
              <dt>Onde</dt>
              <dd>
                {h.establishment} · {h.sector} · {h.activity}
              </dd>
            </div>
            <div>
              <dt>Tipo de perigo</dt>
              <dd>{label(HAZARD_CATEGORY_LABEL, h.category)}</dd>
            </div>
            {h.source && (
              <div>
                <dt>Fonte ou circunstância</dt>
                <dd>{h.source}</dd>
              </div>
            )}
            {h.consequences && (
              <div>
                <dt>Possíveis lesões ou agravos</dt>
                <dd>{h.consequences}</dd>
              </div>
            )}
            {(h.exposed_group || h.exposed_workers_count != null) && (
              <div>
                <dt>Expostos</dt>
                <dd>
                  {[h.exposed_group, h.exposed_workers_count != null ? `${h.exposed_workers_count} trabalhador(es)` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </dd>
              </div>
            )}
            {(h.exposure_time || h.exposure_frequency || h.exposure_intensity) && (
              <div>
                <dt>Exposição</dt>
                <dd>
                  {[h.exposure_time, h.exposure_frequency, h.exposure_intensity]
                    .filter(Boolean)
                    .join(" · ")}
                </dd>
              </div>
            )}
            {h.monitoring_data && (
              <div>
                <dt>Dados de monitoramento</dt>
                <dd>{h.monitoring_data}</dd>
              </div>
            )}
          </dl>

          {h.risks.length === 0 ? (
            <p className="doc-empty">Sem risco avaliado para este perigo.</p>
          ) : (
            <table className="doc-table">
              <thead>
                <tr>
                  <th>Risco</th>
                  <th>Nível</th>
                  <th>Medidas de prevenção</th>
                </tr>
              </thead>
              <tbody>
                {h.risks.map((r) => (
                  <tr key={r.risk_id}>
                    <td>
                      {r.description}
                      {r.needs_reassessment && <em className="doc-flag"> · reavaliação pendente</em>}
                    </td>
                    <td>
                      {r.level ? label(RISK_LEVEL_LABEL, r.level) : "Sem avaliação validada"}
                      {r.severity != null && r.probability != null && (
                        <span className="doc-sub">
                          Severidade {r.severity} · Probabilidade {r.probability}
                        </span>
                      )}
                    </td>
                    <td>
                      {r.controls.length === 0 ? (
                        "Nenhuma"
                      ) : (
                        <ul className="doc-list">
                          {r.controls.map((c) => (
                            <li key={c.id}>
                              {c.description}{" "}
                              <span className="doc-sub-inline">
                                ({label(CONTROL_TYPE_LABEL, c.type)}, {label(CONTROL_STATUS_LABEL, c.status).toLowerCase()})
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}

function ActionPlan({ content }: { content: ActionPlanContent }) {
  if (content.actions.length === 0) {
    return <p className="doc-empty">Nenhuma ação no plano na data da emissão.</p>;
  }
  return (
    <table className="doc-table">
      <thead>
        <tr>
          <th>Ação</th>
          <th>Prioridade</th>
          <th>Prazo</th>
          <th>Situação</th>
          <th>Aferição da eficácia</th>
        </tr>
      </thead>
      <tbody>
        {content.actions.map((a) => (
          <tr key={a.id}>
            <td>
              <strong>{a.title}</strong>
              {a.description && <span className="doc-sub">{a.description}</span>}
            </td>
            <td>{label(ACTION_PRIORITY_LABEL, a.priority)}</td>
            <td>{a.due_date ? formatDay(a.due_date) : "—"}</td>
            <td>
              {label(ACTION_STATUS_LABEL, a.status)}
              <span className="doc-sub">
                {a.evidence_count === 1 ? "1 evidência" : `${a.evidence_count} evidências`}
              </span>
            </td>
            <td>
              {a.effectiveness_criteria ? (
                <>
                  <span className="doc-sub-label">Critério:</span> {a.effectiveness_criteria}
                </>
              ) : (
                "—"
              )}
              {a.effectiveness_result && (
                <span className="doc-sub">
                  <span className="doc-sub-label">Resultado:</span> {a.effectiveness_result}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Criteria({ content }: { content: CriteriaContent }) {
  if (content.methodologies.length === 0) {
    return <p className="doc-empty">Nenhuma metodologia cadastrada na data da emissão.</p>;
  }
  return (
    <div className="doc-items">
      {content.methodologies.map((m) => {
        const v = m.version;
        const levels = v ? [...v.levels].sort((a, b) => a.order - b.order) : [];
        const levelName = (id: string) => levels.find((l) => l.id === id)?.label ?? label(RISK_LEVEL_LABEL, id);
        return (
          <section key={m.id} className="doc-item">
            <h3>
              {m.name}
              {m.is_default && <span className="doc-sub-inline"> (metodologia padrão)</span>}
              {v && <span className="doc-sub-inline"> · versão {v.version}</span>}
            </h3>
            {!v ? (
              <p className="doc-empty">Sem versão publicada.</p>
            ) : (
              <>
                <div className="doc-scales">
                  <table className="doc-table">
                    <thead>
                      <tr>
                        <th colSpan={2}>Severidade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {v.severity_scale.map((s) => (
                        <tr key={s.value}>
                          <td className="doc-num">{s.value}</td>
                          <td>
                            {s.label}
                            {s.description && <span className="doc-sub">{s.description}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <table className="doc-table">
                    <thead>
                      <tr>
                        <th colSpan={2}>Probabilidade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {v.probability_scale.map((s) => (
                        <tr key={s.value}>
                          <td className="doc-num">{s.value}</td>
                          <td>
                            {s.label}
                            {s.description && <span className="doc-sub">{s.description}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <table className="doc-table doc-matrix">
                  <caption>Matriz de risco (severidade × probabilidade)</caption>
                  <thead>
                    <tr>
                      <th scope="col">S \ P</th>
                      {v.probability_scale.map((p) => (
                        <th key={p.value} scope="col">
                          {p.value}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...v.severity_scale].reverse().map((s) => (
                      <tr key={s.value}>
                        <th scope="row">{s.value}</th>
                        {v.probability_scale.map((p) => {
                          const level = v.matrix[`${s.value}-${p.value}`];
                          return <td key={p.value}>{level ? levelName(level) : "—"}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * Documento do PGR como foi emitido — para abrir, imprimir e salvar em PDF
 * pelo próprio navegador. [S2-C]
 */
export function DocumentViewPage() {
  const { id = "" } = useParams();
  const [doc, setDoc] = useState<PgrDocumentFull | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPgrDocument(id)
      .then((data) => {
        if (!cancelled) setDoc(data.document);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Falha ao carregar");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!doc) return;
    // Nome sugerido pelo navegador ao salvar em PDF.
    const previous = document.title;
    document.title = `PGR - ${PGR_TYPE_LABEL[doc.type] ?? doc.type} - v${doc.version}`;
    return () => {
      document.title = previous;
    };
  }, [doc]);

  if (error) {
    return (
      <div>
        <p className="page-error" role="alert">
          {error}
        </p>
        <Link to="/documentos">Voltar aos documentos</Link>
      </div>
    );
  }
  if (!doc) return <LoadingState label="Carregando documento…" />;

  const typeLabel = PGR_TYPE_LABEL[doc.type] ?? doc.type;
  const cnpj = formatCnpj(doc.organization.taxId);

  return (
    <div className="doc-view">
      <div className="doc-toolbar">
        <Link to="/documentos" className="doc-back">
          ← Documentos do PGR
        </Link>
        <Button type="button" onClick={() => window.print()}>
          Imprimir ou salvar em PDF
        </Button>
      </div>

      <article className="doc-paper">
        <header className="doc-header">
          <p className="doc-kicker">Programa de Gerenciamento de Riscos · NR-1</p>
          <h1>{typeLabel}</h1>
          <dl className="doc-meta">
            <div>
              <dt>Organização</dt>
              <dd>
                {doc.organization.name}
                {cnpj && <span className="doc-sub">CNPJ {cnpj}</span>}
              </dd>
            </div>
            <div>
              <dt>Abrangência</dt>
              <dd>{doc.establishment?.name ?? "Todos os estabelecimentos"}</dd>
            </div>
            <div>
              <dt>Versão</dt>
              <dd>{doc.version}</dd>
            </div>
            <div>
              <dt>Emitido em</dt>
              <dd>
                {formatDateTime(doc.issuedAt)}
                <span className="doc-sub">por {doc.issuedBy.name}</span>
              </dd>
            </div>
          </dl>
        </header>

        <div className="doc-body">
          {doc.type === "INVENTORY" && <Inventory content={doc.content as InventoryContent} />}
          {doc.type === "ACTION_PLAN" && <ActionPlan content={doc.content as ActionPlanContent} />}
          {doc.type === "CRITERIA" && <Criteria content={doc.content as CriteriaContent} />}
        </div>

        <footer className="doc-signature">
          <p className="doc-statement">{doc.signatureStatement}</p>
          <div className="doc-signer">
            <strong>{doc.responsibleName}</strong>
            {doc.responsibleRole && <span>{doc.responsibleRole}</span>}
            {doc.responsibleRegistration && <span>Registro {doc.responsibleRegistration}</span>}
            <span className="doc-sub">Aceite eletrônico registrado em {formatDateTime(doc.issuedAt)}</span>
          </div>
          <p className="doc-id">
            Documento emitido no Portal NR-1 · identificador {doc.id}
          </p>
        </footer>
      </article>
    </div>
  );
}
