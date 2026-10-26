import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  fetchTimeEntryList,
  saveTimeEntry,
  type TimeEntry,
} from "@/api/time-entries";
import { Button } from "@/components/Button";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { PeoplePicker } from "@/components/PeoplePicker";
import { formatDay } from "@/lib/labels";
import { useModuleAccess } from "@/lib/module-access";
import "@/components/form.css";

/** "90" vira "+1 h 30 min"; "-45" vira "−45 min". */
function emHoras(minutos: number): string {
  const sinal = minutos < 0 ? "−" : "+";
  const abs = Math.abs(minutos);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (abs === 0) return "0";
  if (h === 0) return `${sinal}${m} min`;
  if (m === 0) return `${sinal}${h} h`;
  return `${sinal}${h} h ${m} min`;
}

/**
 * Banco de horas.
 *
 * Era só um saldo, sem dizer de onde veio nem quando — e a tela não tinha
 * botão para ninguém, embora a rota aceitasse o lançamento do próprio
 * colaborador. Agora quem cuida lança com data, horas e motivo, e o
 * colaborador consulta o que é dele. [S5-M] [S5-O] [CB-32]
 */
export function TimeEntriesPage() {
  const { canManage } = useModuleAccess("ponto");
  const [rows, setRows] = useState<TimeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [pessoa, setPessoa] = useState("");
  const [dia, setDia] = useState("");
  const [horas, setHoras] = useState("");
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");

  const recarregar = useCallback(async () => {
    try {
      setRows(await fetchTimeEntryList(filtro || undefined));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar");
      setRows([]);
    }
  }, [filtro]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  async function lancar(e: FormEvent) {
    e.preventDefault();
    setErroForm(null);
    if (!pessoa) {
      setErroForm("Escolha de quem é o lançamento.");
      return;
    }
    if (!dia) {
      setErroForm("Informe o dia.");
      return;
    }
    const minutos = Math.round(Number(horas.replace(",", ".")) * 60);
    if (!Number.isFinite(minutos) || minutos === 0) {
      setErroForm("Informe as horas: positivo para crédito, negativo para débito.");
      return;
    }
    if (!motivo.trim()) {
      setErroForm("Diga de onde vieram essas horas: é o que a pessoa vai ler.");
      return;
    }
    setSalvando(true);
    try {
      await saveTimeEntry({
        user_id: pessoa,
        day: dia,
        balance_minutes: minutos,
        note: motivo.trim(),
      });
      setDia("");
      setHoras("");
      setMotivo("");
      await recarregar();
    } catch (err) {
      setErroForm(err instanceof Error ? err.message : "Falha ao lançar");
    } finally {
      setSalvando(false);
    }
  }

  const saldo = (rows ?? []).reduce((total, r) => total + r.balanceMinutes, 0);

  return (
    <div>
      <PageHeader
        title="Banco de horas"
        description={
          canManage
            ? "Lance crédito e débito de horas, com o dia e de onde vieram."
            : "Seu saldo de horas e de onde veio cada lançamento."
        }
      />

      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}

      {canManage && (
        <section className="form-section">
          <h2>Lançar horas</h2>
          <form className="form-grid" onSubmit={lancar}>
            <div className="form-grid cols-2">
              <label className="form-field">
                De quem
                <PeoplePicker
                  value={pessoa}
                  onChange={(id) => setPessoa(id)}
                  required
                />
              </label>
              <label className="form-field">
                Dia
                <input
                  type="date"
                  value={dia}
                  onChange={(e) => setDia(e.target.value)}
                  disabled={salvando}
                  required
                />
              </label>
              <label className="form-field">
                Horas
                <input
                  value={horas}
                  onChange={(e) => setHoras(e.target.value)}
                  disabled={salvando}
                  placeholder="Ex.: 2 ou -1,5"
                  required
                />
                <span className="form-hint">
                  Positivo para crédito, negativo para débito. Meia hora é 0,5.
                </span>
              </label>
              <label className="form-field">
                De onde vieram
                <input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  disabled={salvando}
                  placeholder="Ex.: hora extra na parada de máquina"
                  required
                />
              </label>
            </div>
            {erroForm && (
              <p className="form-error" role="alert">
                {erroForm}
              </p>
            )}
            <div className="form-actions">
              <Button type="submit" disabled={salvando}>
                {salvando ? "Lançando…" : "Lançar"}
              </Button>
            </div>
          </form>
        </section>
      )}

      {canManage && (
        <section className="form-section">
          <h2>Ver o de alguém</h2>
          <PeoplePicker value={filtro} onChange={(id) => setFiltro(id)} />
        </section>
      )}

      {rows === null && <LoadingState />}

      {rows && rows.length === 0 && (
        <p className="muted">Nenhum lançamento.</p>
      )}

      {rows && rows.length > 0 && (
        <section className="form-section">
          <h2>Lançamentos</h2>
          <p className="muted">Saldo no período: {emHoras(saldo)}</p>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Dia</th>
                  <th>Horas</th>
                  <th>De onde vieram</th>
                  {/* Saldo sem autor não prova nada. [CB-66] */}
                  <th>Lançado por</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDay(r.day)}</td>
                    <td>{emHoras(r.balanceMinutes)}</td>
                    <td className="muted">{r.note ?? "—"}</td>
                    <td className="muted">{r.createdBy?.name ?? "—"}</td>
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
