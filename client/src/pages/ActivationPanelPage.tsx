import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ACTIVATION_SITUATION_LABEL,
  classifyLegacyAccount,
  fetchActivationPanel,
  reopenFirstAccess,
  type ActivationPerson,
  type ActivationSituation,
} from "@/api/activation";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { ListShell } from "@/components/ListShell";
import { formatDay, formatInstant } from "@/lib/labels";
import "./denuncia.css";

const ORDEM: ActivationSituation[] = [
  "ACTIVE",
  "TEMP_PASSWORD",
  "AWAITING",
  "MISSING_DATA",
  "BLOCKED",
  "WINDOW_EXPIRED",
  "LEGACY_UNCLASSIFIED",
];

function tom(s: ActivationSituation): "success" | "info" | "warning" | "danger" | "neutral" {
  if (s === "ACTIVE") return "success";
  if (s === "AWAITING" || s === "TEMP_PASSWORD") return "info";
  if (s === "BLOCKED") return "danger";
  if (s === "MISSING_DATA" || s === "WINDOW_EXPIRED") return "warning";
  return "neutral";
}

/**
 * Painel de ativação das contas: quem já entrou, quem aguarda o primeiro
 * acesso, quem está sem dados, bloqueado, com prazo vencido, e as contas
 * antigas ainda não classificadas. Master, Dono e RH agem; o gerente só vê,
 * e só as unidades que gere. [C3-5]
 * [C1-7]
 */
export function ActivationPanelPage() {
  const [dados, setDados] = useState<Awaited<ReturnType<typeof fetchActivationPanel>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [situacao, setSituacao] = useState<ActivationSituation | "">("");
  const [unidade, setUnidade] = useState("");
  const [classificando, setClassificando] = useState<ActivationPerson | null>(null);
  const [desfecho, setDesfecho] = useState<"NEVER_SIGNED_IN" | "IN_USE" | "">("");
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [acaoErro, setAcaoErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    fetchActivationPanel()
      .then(setDados)
      .catch((err) => setError(err instanceof Error ? err.message : "Falha ao carregar"));
  }, []);
  useEffect(carregar, [carregar]);

  const linhas = useMemo(
    () =>
      (dados?.people ?? []).filter(
        (p) =>
          (!situacao || p.situation === situacao) &&
          (!unidade || (p.establishment?.id ?? "sem-unidade") === unidade),
      ),
    [dados, situacao, unidade],
  );

  async function reabrir(p: ActivationPerson) {
    setBusy(true);
    setAcaoErro(null);
    try {
      await reopenFirstAccess(p.userId);
      carregar();
    } catch (err) {
      setAcaoErro(err instanceof Error ? err.message : "Falha ao reabrir");
    } finally {
      setBusy(false);
    }
  }

  async function classificar(e: FormEvent) {
    e.preventDefault();
    if (!classificando || !desfecho || !motivo.trim()) return;
    setBusy(true);
    setAcaoErro(null);
    try {
      await classifyLegacyAccount(classificando.userId, desfecho, motivo.trim());
      setClassificando(null);
      setDesfecho("");
      setMotivo("");
      carregar();
    } catch (err) {
      setAcaoErro(err instanceof Error ? err.message : "Falha ao classificar");
    } finally {
      setBusy(false);
    }
  }

  const podeAgir = Boolean(dados?.can_act);

  return (
    <ListShell
      title="Ativação de contas"
      description="Quem já entrou no portal e quem ainda não. O primeiro acesso é feito pela própria pessoa, com matrícula, CPF e data de nascimento."
      loading={!dados && !error}
      error={error}
      empty={(dados?.people.length ?? 0) === 0}
      emptyTitle="Nenhuma pessoa"
      emptyDescription="As pessoas cadastradas na empresa aparecem aqui."
      before={
        dados && (
          <>
            <div className="data-table-wrap" style={{ marginBottom: "1rem" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Unidade</th>
                    {ORDEM.map((s) => (
                      <th key={s}>{ACTIVATION_SITUATION_LABEL[s]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dados.totals_by_unit.map((t) => (
                    <tr key={t.id}>
                      <td>{t.name}</td>
                      {ORDEM.map((s) => (
                        <td key={s}>{t.counts[s] ?? 0}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="filter-bar">
              <select
                aria-label="Situação"
                value={situacao}
                onChange={(e) => setSituacao(e.target.value as ActivationSituation | "")}
              >
                <option value="">Toda situação</option>
                {ORDEM.map((s) => (
                  <option key={s} value={s}>
                    {ACTIVATION_SITUATION_LABEL[s]}
                  </option>
                ))}
              </select>
              <select aria-label="Unidade" value={unidade} onChange={(e) => setUnidade(e.target.value)}>
                <option value="">Todas as unidades</option>
                {dados.totals_by_unit.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {/* Quem só lê é o gerente, e ele vê só as unidades que gere. [C3-5] */}
              {!podeAgir && (
                <span className="muted">
                  Só leitura, das unidades que você gere: as ações são de Master, Dono e RH.
                </span>
              )}
            </div>
          </>
        )
      }
    >
      {acaoErro && (
        <p className="form-error" role="alert">
          {acaoErro}
        </p>
      )}
      {classificando && (
        <form className="form-section form-grid" onSubmit={classificar}>
          <h2>Classificar a conta de {classificando.name}</h2>
          <p className="muted" style={{ margin: 0 }}>
            Última entrada registrada:{" "}
            {classificando.lastSigninAt
              ? formatInstant(classificando.lastSigninAt)
              : "nenhuma (a trilha registra entradas desde 17/10/2026)"}
            .
          </p>
          <fieldset className="form-field ethics-question">
            <legend>O que a verificação mostrou?</legend>
            <label>
              <input
                type="radio"
                name="desfecho"
                checked={desfecho === "NEVER_SIGNED_IN"}
                onChange={() => setDesfecho("NEVER_SIGNED_IN")}
                required
              />
              <span>Nunca entrou — liberar o primeiro acesso por 30 dias</span>
            </label>
            <label>
              <input
                type="radio"
                name="desfecho"
                checked={desfecho === "IN_USE"}
                onChange={() => setDesfecho("IN_USE")}
              />
              <span>Já usa a conta — marcar como ativa</span>
            </label>
          </fieldset>
          <label className="form-field">
            Justificativa
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              required
              placeholder="O que foi verificado (por exemplo: conferido com a pessoa e com o gerente da unidade)."
            />
          </label>
          <div className="form-actions">
            <Button type="submit" disabled={busy || !desfecho || !motivo.trim()}>
              {busy ? "Salvando…" : "Classificar"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setClassificando(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
      <p className="filter-meta muted">
        {linhas.length === 1 ? "1 pessoa" : `${linhas.length} pessoas`}
      </p>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Pessoa</th>
              <th>Unidade</th>
              <th>Situação</th>
              <th>Detalhe</th>
              {podeAgir && <th>Ação</th>}
            </tr>
          </thead>
          <tbody>
            {linhas.map((p) => (
              <tr key={p.userId}>
                <td>
                  <strong>{p.name}</strong>
                  <div className="muted ethics-excerpt">{p.login}</div>
                </td>
                <td>{p.establishment?.name ?? "—"}</td>
                <td>
                  <Chip tone={tom(p.situation)}>{ACTIVATION_SITUATION_LABEL[p.situation]}</Chip>
                </td>
                <td className="muted">
                  {p.situation === "BLOCKED" && p.lockedUntil && `Até ${formatInstant(p.lockedUntil)}. `}
                  {p.situation === "MISSING_DATA" && `Falta: ${p.missing.join(", ")}. `}
                  {p.situation === "AWAITING" && p.firstAccessUntil && `Liberado até ${formatDay(p.firstAccessUntil)}. `}
                  {p.situation === "ACTIVE" && p.activatedAt && `Ativada em ${formatDay(p.activatedAt)}. `}
                  {p.failures24h > 0 && `${p.failures24h} erro(s) nas últimas 24 h.`}
                </td>
                {podeAgir && (
                  <td>
                    {!p.activatedAt && p.firstAccessEligible && p.situation !== "AWAITING" && (
                      <Button type="button" variant="secondary" disabled={busy} onClick={() => reabrir(p)}>
                        Reabrir primeiro acesso
                      </Button>
                    )}
                    {p.situation === "LEGACY_UNCLASSIFIED" && (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => {
                          setClassificando(p);
                          setDesfecho("");
                          setMotivo("");
                        }}
                      >
                        Classificar
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ListShell>
  );
}
