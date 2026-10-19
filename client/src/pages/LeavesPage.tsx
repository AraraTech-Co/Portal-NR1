import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  cancelLeave,
  decideLeave,
  fetchLeaveRequests,
  requestLeave,
  type Leave,
} from "@/api/leaves";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { formatDay, LEAVE_KIND_LABEL, LEAVE_STATUS_LABEL } from "@/lib/labels";
import { useModuleAccess } from "@/lib/module-access";
import "@/components/form.css";

function tone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "APPROVED") return "success";
  if (status === "REQUESTED") return "warning";
  if (status === "REJECTED") return "danger";
  return "neutral";
}

/** Diferença em dias, inclusive, como o servidor conta. */
function dias(inicio: string, fim: string): number {
  if (!inicio || !fim) return 0;
  const a = new Date(`${inicio}T00:00:00Z`).getTime();
  const b = new Date(`${fim}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * Férias e licenças: pedir, acompanhar e decidir.
 *
 * A tela era só uma lista, com o tipo e a situação em código ("VACATION",
 * "APPROVED"), sem o que o trabalhador escreveu e sem dizer a quem decide se
 * a pessoa tem direito. [S5-D] [CB-32]
 */
export function LeavesPage() {
  const { user } = useAuth();
  const { canManage } = useModuleAccess("ferias");
  const [rows, setRows] = useState<Leave[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState("VACATION");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [observacao, setObservacao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);

  const [decidindo, setDecidindo] = useState<string | null>(null);
  const [motivo, setMotivo] = useState<Record<string, string>>({});

  const recarregar = useCallback(async () => {
    try {
      setRows(await fetchLeaveRequests());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  async function pedir(e: FormEvent) {
    e.preventDefault();
    setErroForm(null);
    if (!inicio || !fim) {
      setErroForm("Informe o primeiro e o último dia.");
      return;
    }
    if (dias(inicio, fim) === 0) {
      setErroForm("O último dia não pode ser antes do primeiro.");
      return;
    }
    setEnviando(true);
    try {
      await requestLeave({
        kind,
        start_date: inicio,
        end_date: fim,
        note: observacao.trim() || undefined,
      });
      setInicio("");
      setFim("");
      setObservacao("");
      await recarregar();
    } catch (err) {
      setErroForm(err instanceof Error ? err.message : "Falha ao enviar");
    } finally {
      setEnviando(false);
    }
  }

  async function decidir(leave: Leave, status: "APPROVED" | "REJECTED") {
    const nota = motivo[leave.id]?.trim() ?? "";
    if (status === "REJECTED" && !nota) {
      setError("Ao recusar, diga o motivo: é o que a pessoa vai ler.");
      return;
    }
    setDecidindo(leave.id);
    try {
      await decideLeave(leave.id, {
        status,
        decision_note: nota || undefined,
      });
      setMotivo((m) => ({ ...m, [leave.id]: "" }));
      await recarregar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao decidir");
    } finally {
      setDecidindo(null);
    }
  }

  async function cancelar(leave: Leave) {
    setDecidindo(leave.id);
    try {
      await cancelLeave(leave.id);
      await recarregar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao cancelar");
    } finally {
      setDecidindo(null);
    }
  }

  const meuDireito = rows?.find((r) => r.userId === user?.id)?.vacation_right;

  return (
    <div>
      <PageHeader
        title="Férias e licenças"
        description="Peça férias, folga ou licença e acompanhe a decisão."
      />

      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}

      <section className="form-section">
        <h2>Pedir</h2>
        <form className="form-grid" onSubmit={pedir}>
          <div className="form-grid cols-2">
            <label className="form-field">
              O que você quer pedir
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                disabled={enviando}
              >
                {Object.entries(LEAVE_KIND_LABEL).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
              {/* O direito a férias fecha com 12 meses de casa (CLT art. 130):
                  a tela diz, em vez de a pessoa contar de cabeça. [S5-D] */}
              {kind === "VACATION" && meuDireito && (
                <span className="form-hint">
                  {meuDireito.entitled
                    ? "Você já completou 12 meses de casa."
                    : meuDireito.complete_at
                      ? `Seu período aquisitivo fecha em ${formatDay(meuDireito.complete_at)}.`
                      : "Sem data de admissão na ficha — o RH confere."}
                </span>
              )}
            </label>
            <label className="form-field">
              Observação (opcional)
              <input
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                disabled={enviando}
                placeholder="Ex.: viagem marcada com a família"
              />
            </label>
            <label className="form-field">
              Primeiro dia
              <input
                type="date"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
                disabled={enviando}
                required
              />
            </label>
            <label className="form-field">
              Último dia
              <input
                type="date"
                value={fim}
                onChange={(e) => setFim(e.target.value)}
                disabled={enviando}
                required
              />
              {dias(inicio, fim) > 0 && (
                <span className="form-hint">
                  {dias(inicio, fim)} dia(s).
                </span>
              )}
            </label>
          </div>
          {erroForm && (
            <p className="form-error" role="alert">
              {erroForm}
            </p>
          )}
          <div className="form-actions">
            <Button type="submit" disabled={enviando}>
              {enviando ? "Enviando…" : "Enviar pedido"}
            </Button>
          </div>
        </form>
      </section>

      {rows === null && <LoadingState />}

      {rows && rows.length === 0 && (
        <p className="muted">Nenhum pedido ainda.</p>
      )}

      {rows && rows.length > 0 && (
        <section className="form-section">
          <h2>{canManage ? "Pedidos da empresa" : "Seus pedidos"}</h2>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {canManage && <th>Pessoa</th>}
                  <th>O quê</th>
                  <th>Quando</th>
                  <th>Situação</th>
                  <th>O que a pessoa escreveu</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    {canManage && (
                      <td>
                        <strong>{r.user.name}</strong>
                        {/* Quem decide precisa saber se há direito. [S5-D] */}
                        {r.kind === "VACATION" && r.vacation_right && (
                          <div className="muted">
                            {r.vacation_right.entitled
                              ? "12 meses completos"
                              : r.vacation_right.complete_at
                                ? `Período fecha em ${formatDay(r.vacation_right.complete_at)}`
                                : "Sem admissão na ficha"}
                          </div>
                        )}
                      </td>
                    )}
                    <td>{LEAVE_KIND_LABEL[r.kind] ?? r.kind}</td>
                    <td className="muted">
                      {formatDay(r.startDate)} a {formatDay(r.endDate)}
                      <div className="muted">{r.days} dia(s)</div>
                    </td>
                    <td>
                      <Chip tone={tone(r.status)}>
                        {LEAVE_STATUS_LABEL[r.status] ?? r.status}
                      </Chip>
                      {r.decisionNote && (
                        <div className="muted">{r.decisionNote}</div>
                      )}
                      {r.decidedBy && (
                        <div className="muted">
                          por {r.decidedBy.name}
                          {r.decidedAt ? ` em ${formatDay(r.decidedAt)}` : ""}
                        </div>
                      )}
                    </td>
                    {/* O que a pessoa escreveu não aparecia em lugar nenhum. */}
                    <td className="muted">{r.note ?? "—"}</td>
                    <td>
                      {canManage && r.status === "REQUESTED" && (
                        <div className="form-grid">
                          <input
                            value={motivo[r.id] ?? ""}
                            onChange={(e) =>
                              setMotivo((m) => ({ ...m, [r.id]: e.target.value }))
                            }
                            placeholder="Motivo (obrigatório ao recusar)"
                          />
                          <div className="form-actions">
                            <Button
                              type="button"
                              disabled={decidindo === r.id}
                              onClick={() => void decidir(r, "APPROVED")}
                            >
                              Aprovar
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={decidindo === r.id}
                              onClick={() => void decidir(r, "REJECTED")}
                            >
                              Recusar
                            </Button>
                          </div>
                        </div>
                      )}
                      {!canManage &&
                        r.status === "REQUESTED" &&
                        r.userId === user?.id && (
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={decidindo === r.id}
                            onClick={() => void cancelar(r)}
                          >
                            Cancelar
                          </Button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
