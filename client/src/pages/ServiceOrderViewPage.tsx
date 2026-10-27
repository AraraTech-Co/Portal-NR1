import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  acknowledgeServiceOrder,
  fetchServiceOrder,
  fetchServiceOrderAcks,
  type ServiceOrderFull,
} from "@/api/service-orders";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { LoadingState } from "@/components/LoadingState";
import {
  CONTROL_STATUS_LABEL,
  CONTROL_TYPE_LABEL,
  HAZARD_CATEGORY_LABEL,
  RISK_LEVEL_LABEL,
} from "@/lib/labels";
import "./document-view.css";
import "./service-orders.css";

type AckRow = {
  id: string;
  name: string;
  /** Identifica a pessoa no papel, onde dois homônimos não se distinguem. */
  registration: string | null;
  acknowledged_at: string | null;
};

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

/** Linhas em branco do texto digitado viram parágrafos, não um bloco só. */
function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n{2,}/)
        .map((bloco, i) => (
          <p key={i} className="so-text">
            {bloco.split("\n").map((linha, j, todas) => (
              <span key={j}>
                {linha}
                {j < todas.length - 1 && <br />}
              </span>
            ))}
          </p>
        ))}
    </>
  );
}

/**
 * Quem deu ciência e quem falta — só para quem emite e para a fiscalização.
 *
 * Vai também no papel, como anexo no fim: se o fiscal pede a prova em PDF,
 * ou a empresa arquiva a ordem, a ciência tem de ir junto. A folha solta se
 * identifica sozinha, com função, versão e emissão repetidas. [B2-4-G]
 */
function Acknowledgements({
  order,
  rows,
  onReceipt,
}: {
  order: ServiceOrderFull;
  rows: AckRow[];
  onReceipt: (userId: string) => void;
}) {
  const deram = rows.filter((r) => r.acknowledged_at).length;

  return (
    <section className="so-acks">
      <h2>
        Ciência dos trabalhadores{" "}
        <span className="doc-sub-inline">
          {deram} de {rows.length}
        </span>
      </h2>
      <p className="so-annex-id">
        {order.jobRole.name} · v{order.version} · emitida em{" "}
        {formatDateTime(order.issuedAt)} · {order.organization.name}
      </p>
      {rows.length === 0 ? (
        <p className="doc-empty">Nenhum trabalhador ativo nesta função.</p>
      ) : (
        <ul className="so-ack-list">
          {rows.map((r) => (
            <li key={r.id}>
              <span>
                {r.name}
                {r.registration && (
                  <span className="doc-sub-inline"> · {r.registration}</span>
                )}
              </span>
              <span className="so-ack-right">
                {r.acknowledged_at ? (
                  <span className="so-ack-ok">{formatDateTime(r.acknowledged_at)}</span>
                ) : (
                  <span className="so-pending">sem ciência</span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  className="so-receipt-button"
                  onClick={() => onReceipt(r.id)}
                >
                  Comprovante
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * O comprovante de uma pessoa, para assinar no papel.
 *
 * A ciência no portal já fica com data e hora; o comprovante é para quem
 * precisa da assinatura — auditoria, arquivo, quem não usa o portal. [B2-4-G]
 */
function Receipt({
  order,
  person,
  only,
}: {
  order: ServiceOrderFull;
  person: AckRow;
  only: boolean;
}) {
  return (
    <section className={`so-receipt${only ? " is-only" : ""}`}>
      <h2>Comprovante de ciência — ordem de serviço</h2>
      <dl className="so-receipt-facts">
        <div>
          <dt>Empresa</dt>
          <dd>{order.organization.name}</dd>
        </div>
        <div>
          <dt>Função</dt>
          <dd>{order.jobRole.name}</dd>
        </div>
        <div>
          <dt>Versão</dt>
          <dd>
            v{order.version} · emitida em {formatDateTime(order.issuedAt)}
          </dd>
        </div>
        <div>
          <dt>Trabalhador</dt>
          <dd>
            {person.name}
            {person.registration ? ` · matrícula ${person.registration}` : ""}
          </dd>
        </div>
      </dl>
      <p className="so-text">
        {/* O comprovante sai em folha própria, sem a ordem: "acima" não
            apontava para nada. [B3-4-H] */}
        Declaro que recebi, li e entendi a ordem de serviço identificada nesta
        folha, que diz a que estou exposto, como me proteger e o que devo
        fazer.
      </p>
      <p className="so-receipt-state">
        {person.acknowledged_at
          ? `Ciência registrada no portal em ${formatDateTime(person.acknowledged_at)}.`
          : "Ciência ainda não registrada no portal."}
      </p>
      <div className="so-receipt-sign">
        <span>Assinatura</span>
        <span>Data</span>
      </div>
      <p className="doc-id">
        Ordem de serviço emitida no Portal NR-1 · identificador {order.id}
      </p>
    </section>
  );
}

/**
 * A ordem de serviço como foi emitida — para ler, imprimir e dar ciência.
 * O conteúdo é o retrato do instante da emissão, não o inventário de
 * hoje: é isso que foi dado a conhecer. [S7-F]
 */
export function ServiceOrderViewPage() {
  const { id = "" } = useParams();
  const [order, setOrder] = useState<ServiceOrderFull | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ackError, setAckError] = useState<string | null>(null);
  const [acking, setAcking] = useState(false);
  /** A lista de ciência — nula para quem não pode vê-la. [B2-4-G] */
  const [acks, setAcks] = useState<AckRow[] | null>(null);
  /** Sai um comprovante por pessoa junto com a ordem. */
  const [comComprovantes, setComComprovantes] = useState(true);
  /** Imprimir só o comprovante desta pessoa. */
  const [apenas, setApenas] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await fetchServiceOrder(id);
    setOrder(data.service_order);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    load().catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Falha ao carregar");
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    fetchServiceOrderAcks(id)
      .then((data) => {
        if (!cancelled) setAcks(data.people);
      })
      .catch(() => {
        // Quem não emite nem fiscaliza não vê a lista: não é erro de tela.
        if (!cancelled) setAcks(null);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  /*
    Imprimir um comprovante só: o estado precisa estar na tela ANTES de
    chamar a impressão, por isso ela sai daqui e não do clique.
  */
  useEffect(() => {
    if (!apenas) return;
    const limpar = () => setApenas(null);
    window.addEventListener("afterprint", limpar, { once: true });
    window.print();
    return () => window.removeEventListener("afterprint", limpar);
  }, [apenas]);

  useEffect(() => {
    if (!order) return;
    const previous = document.title;
    document.title = `Ordem de servico - ${order.jobRole.name} - v${order.version}`;
    return () => {
      document.title = previous;
    };
  }, [order]);

  async function darCiencia() {
    setAcking(true);
    setAckError(null);
    try {
      await acknowledgeServiceOrder(id);
      await load();
    } catch (err) {
      setAckError(err instanceof Error ? err.message : "Falha ao registrar a ciência");
    } finally {
      setAcking(false);
    }
  }

  if (error) {
    return (
      <div>
        <p className="page-error" role="alert">
          {error}
        </p>
        <Link to="/ordens-servico">Voltar às ordens de serviço</Link>
      </div>
    );
  }
  if (!order) return <LoadingState label="Carregando ordem de serviço…" />;

  const cnpj = formatCnpj(order.organization.taxId);
  const { content } = order;

  const comprovantes = comComprovantes ? (acks ?? []) : [];

  return (
    <div className={`doc-view${apenas ? " so-print-one" : ""}`}>
      <div className="doc-toolbar">
        <Link to="/ordens-servico" className="doc-back">
          ← Ordens de serviço
        </Link>
        <Button type="button" onClick={() => window.print()}>
          Imprimir ou salvar em PDF
        </Button>
      </div>

      {/* O que sai no papel além do documento. [B2-4-G] */}
      {acks && acks.length > 0 && (
        <label className="so-print-option">
          <input
            type="checkbox"
            checked={comComprovantes}
            onChange={(e) => setComComprovantes(e.target.checked)}
          />
          Incluir um comprovante por pessoa para assinar ({acks.length}{" "}
          {acks.length === 1 ? "folha" : "folhas"})
        </label>
      )}

      {!order.is_current && (
        <p className="filter-meta so-alert">
          Esta é a v{order.version}. A versão vigente é a v{order.current_version}.
        </p>
      )}

      <article className="doc-paper">
        <header className="doc-header">
          <p className="doc-kicker">Ordem de serviço de segurança e saúde · NR-1 1.4.1 "c"</p>
          <h1>{order.jobRole.name}</h1>
          <dl className="doc-meta">
            <div>
              <dt>Organização</dt>
              <dd>
                {order.organization.name}
                {cnpj && <span className="doc-sub">CNPJ {cnpj}</span>}
              </dd>
            </div>
            <div>
              <dt>Onde</dt>
              <dd>
                {order.jobRole.sector.establishment.name}
                <span className="doc-sub">
                  {order.jobRole.sector.name}
                  {content.job_role.establishment_address
                    ? ` · ${content.job_role.establishment_address}`
                    : ""}
                </span>
              </dd>
            </div>
            <div>
              <dt>Versão</dt>
              <dd>{order.version}</dd>
            </div>
            <div>
              <dt>Emitida em</dt>
              <dd>
                {formatDateTime(order.issuedAt)}
                <span className="doc-sub">por {order.issuedBy.name}</span>
              </dd>
            </div>
          </dl>
        </header>

        <div className="doc-body">
          {content.job_role.description && (
            <section>
              <h2>O que a função faz</h2>
              <p className="so-text">{content.job_role.description}</p>
            </section>
          )}

          <section>
            <h2>A que você está exposto</h2>
            {content.activities.length === 0 ? (
              <p className="doc-empty">
                Nenhuma atividade ligada a esta função no momento da emissão.
              </p>
            ) : (
              <div className="doc-items">
                {content.activities.map((a) => (
                  <section key={a.id} className="doc-item">
                    <h3>{a.name}</h3>
                    {a.description && <p className="so-text">{a.description}</p>}
                    {a.hazards.length === 0 ? (
                      <p className="doc-empty">
                        Nenhum perigo registrado nesta atividade.
                      </p>
                    ) : (
                      <table className="doc-table">
                        <thead>
                          <tr>
                            <th>Perigo</th>
                            <th>Risco</th>
                            <th>Nível</th>
                            <th>Como nos protegemos</th>
                          </tr>
                        </thead>
                        <tbody>
                          {a.hazards.flatMap((h) =>
                            h.risks.length === 0
                              ? [
                                  <tr key={h.id}>
                                    <td>
                                      <strong>{h.description}</strong>
                                      <div className="doc-sub">
                                        {label(HAZARD_CATEGORY_LABEL, h.category)}
                                      </div>
                                    </td>
                                    <td colSpan={3} className="doc-empty">
                                      Sem risco avaliado
                                    </td>
                                  </tr>,
                                ]
                              : h.risks.map((r, i) => (
                                  <tr key={r.id}>
                                    {i === 0 && (
                                      <td rowSpan={h.risks.length}>
                                        <strong>{h.description}</strong>
                                        <div className="doc-sub">
                                          {label(HAZARD_CATEGORY_LABEL, h.category)}
                                          {h.source ? ` · ${h.source}` : ""}
                                        </div>
                                        {h.consequences && (
                                          <div className="doc-sub">
                                            Pode causar: {h.consequences}
                                          </div>
                                        )}
                                      </td>
                                    )}
                                    <td>{r.description}</td>
                                    <td>
                                      {r.level ? (
                                        <span className="so-nivel">
                                          {label(RISK_LEVEL_LABEL, r.level)}
                                        </span>
                                      ) : (
                                        <span className="doc-empty">
                                          ainda sem avaliação validada
                                        </span>
                                      )}
                                    </td>
                                    <td>
                                      {r.controls.length === 0 ? (
                                        <span className="doc-empty">
                                          nenhuma medida registrada
                                        </span>
                                      ) : (
                                        <ul className="doc-list">
                                          {r.controls.map((c) => (
                                            <li key={c.id}>
                                              {c.description}
                                              <span className="doc-sub-inline">
                                                {" "}
                                                ({label(CONTROL_TYPE_LABEL, c.type)} ·{" "}
                                                {label(CONTROL_STATUS_LABEL, c.status)})
                                              </span>
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </td>
                                  </tr>
                                )),
                          )}
                        </tbody>
                      </table>
                    )}
                  </section>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2>Suas obrigações</h2>
            <Paragraphs text={order.duties} />
          </section>

          {order.emergencyInstructions && (
            <section>
              <h2>Em caso de emergência</h2>
              <Paragraphs text={order.emergencyInstructions} />
            </section>
          )}

          {content.requirements.length > 0 && (
            <section>
              <h2>Treinamentos e exigências da função</h2>
              <ul className="doc-list">
                {content.requirements.map((q) => (
                  <li key={q.id}>
                    {q.name}
                    {q.validity_months ? (
                      <span className="doc-sub-inline">
                        {" "}
                        (validade de {q.validity_months} meses)
                      </span>
                    ) : null}
                    {q.description && <div className="doc-sub">{q.description}</div>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <footer className="doc-signature">
          <div className="doc-signer">
            <strong>{order.responsibleName}</strong>
            {order.responsibleRole && <span>{order.responsibleRole}</span>}
            {order.responsibleRegistration && (
              <span>Registro {order.responsibleRegistration}</span>
            )}
            <span className="doc-sub">
              Emitida em {formatDateTime(order.issuedAt)}
            </span>
          </div>
          {/* Quem não é da função não vê caixa nenhuma aqui. */}
          {(order.my_ack_at || order.can_acknowledge || ackError) && (
          <div className="so-ack-box">
            {order.my_ack_at ? (
              <Chip tone="success">
                Ciência registrada em {formatDateTime(order.my_ack_at)}
              </Chip>
            ) : order.can_acknowledge ? (
              <>
                <p className="so-text">
                  Ao dar ciência você declara que leu e entendeu esta ordem de
                  serviço. Fica registrado com data e hora.
                </p>
                <Button type="button" disabled={acking} onClick={() => void darCiencia()}>
                  {acking ? "Registrando…" : "Dou ciência"}
                </Button>
              </>
            ) : null}
            {ackError && (
              <p className="form-error" role="alert">
                {ackError}
              </p>
            )}
          </div>
          )}
          <p className="doc-id">
            Ordem de serviço emitida no Portal NR-1 · identificador {order.id}
          </p>
        </footer>
      </article>

      {acks && (
        <Acknowledgements order={order} rows={acks} onReceipt={setApenas} />
      )}

      {(apenas ? (acks ?? []) : comprovantes).map((p) => (
        <Receipt
          key={p.id}
          order={order}
          person={p}
          only={apenas === p.id}
        />
      ))}
    </div>
  );
}
