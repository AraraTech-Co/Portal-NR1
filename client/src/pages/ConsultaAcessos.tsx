import { useCallback, useEffect, useState } from "react";
import { request } from "@/api/client";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";

type Acesso = {
  id: string;
  path: string;
  at: string;
  user: { id: string; name: string } | null;
};

/** Rota da API → nome da tela, para quem lê o registro. */
const ROUTE_LABEL: [string, string][] = [
  ["/api/pgr-documents", "Documentos do PGR"],
  ["/api/inventory", "Inventário de riscos"],
  ["/api/hazards", "Inventário de riscos"],
  ["/api/risks", "Inventário de riscos"],
  ["/api/assessments", "Inventário de riscos"],
  ["/api/controls", "Inventário de riscos"],
  ["/api/methodologies", "Critérios de avaliação"],
  ["/api/actions", "Plano de ação"],
  ["/api/evidences", "Evidência de ação"],
  ["/api/occurrences", "Ocorrências"],
  ["/api/aeps", "Avaliação ergonômica"],
  ["/api/psychosocial-factors", "Avaliação ergonômica"],
  ["/api/preliminary-surveys", "Avaliação ergonômica"],
  ["/api/emergency-procedures", "Emergências"],
  ["/api/establishments", "Operação"],
  ["/api/sectors", "Operação"],
  ["/api/activities", "Operação"],
  ["/api/job-roles", "Operação"],
  ["/api/change-events", "Operação"],
  ["/api/contractors", "Terceiros"],
  ["/api/participations", "Participação"],
  ["/api/trainings", "Treinamentos"],
  ["/api/occupational-exams", "Saúde: exames"],
  ["/api/worker-certificates", "Saúde: certificados"],
  ["/api/job-role-requirements", "Saúde: exigências por função"],
  ["/api/hr-documents", "Documentos do RH"],
  ["/api/summons", "Convocações"],
  ["/api/employee-profiles", "Colaboradores"],
];

function screenOf(path: string): string {
  return ROUTE_LABEL.find(([prefix]) => path.startsWith(prefix))?.[1] ?? "Outra consulta";
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/**
 * O que o fiscal (acesso só de consulta) abriu no portal. Fica com quem dá
 * o acesso: Conta e usuários. [S7-A]
 */
export function ConsultaAcessos() {
  const [rows, setRows] = useState<Acesso[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    request<{ acessos: Acesso[] }>("/api/consulta-acessos")
      .then((data) => {
        if (!cancelled) setRows(data.acessos);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Falha ao carregar");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="form-section">
      <h2>O que o fiscal consultou</h2>
      <p className="muted">
        Quem tem acesso de fiscal só lê, e cada tela que abre fica registrada aqui.
        Mostra as 500 consultas mais recentes.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!error && rows === null && <p className="muted">Carregando…</p>}
      {rows && rows.length === 0 && <p className="muted">Nenhuma consulta registrada.</p>}
      {rows && rows.length > 0 && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Quem</th>
                <th>O que abriu</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="muted">{formatDateTime(r.at)}</td>
                  <td>{r.user?.name ?? "—"}</td>
                  <td>
                    {screenOf(r.path)}
                    <div className="muted" style={{ fontSize: "0.78rem", wordBreak: "break-all" }}>
                      {r.path}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type Fiscal = {
  id: string;
  user: { id: string; name: string; email: string | null };
  access_expires_at: string | null;
  active: boolean;
};

function todayIso(): string {
  return new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
}

function isoDay(value: string | null): string {
  if (!value) return "";
  return new Date(new Date(value).getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

function formatDayOf(value: string | null): string {
  if (!value) return "sem prazo";
  return new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/**
 * Quem tem acesso de fiscal e até quando. O acesso cai sozinho no fim do
 * dia marcado; aqui se renova ou se encerra na hora. [S7-A]
 */
export function FiscaisComAcesso() {
  const [rows, setRows] = useState<Fiscal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const data = await request<{ fiscais: Fiscal[] }>("/api/fiscais");
    setRows(data.fiscais);
  }, []);

  useEffect(() => {
    reload().catch((err) => setError(err instanceof Error ? err.message : "Falha ao carregar"));
  }, [reload]);

  async function change(id: string, body: { access_until?: string; end_now?: boolean }) {
    setBusy(id);
    setError(null);
    try {
      await request(`/api/fiscais/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="form-section">
      <h2>Fiscais com acesso</h2>
      <p className="muted">
        O fiscal só consulta e perde o acesso sozinho no fim do dia marcado. Para dar o
        acesso, aprove o pedido de entrada com o papel “Fiscal (só consulta)”.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!error && rows === null && <p className="muted">Carregando…</p>}
      {rows && rows.length === 0 && <p className="muted">Nenhum fiscal cadastrado.</p>}
      {rows && rows.length > 0 && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Fiscal</th>
                <th>Situação</th>
                <th>Acesso até</th>
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => {
                const value = dates[f.id] ?? isoDay(f.access_expires_at);
                return (
                  <tr key={f.id}>
                    <td>
                      <strong>{f.user.name}</strong>
                      {f.user.email && <div className="muted">{f.user.email}</div>}
                    </td>
                    <td>
                      {f.active ? (
                        <Chip tone="success">Com acesso</Chip>
                      ) : (
                        <Chip tone="neutral">Encerrado</Chip>
                      )}
                      <div className="muted" style={{ marginTop: "0.2rem" }}>
                        {f.active ? "até" : "em"} {formatDayOf(f.access_expires_at)}
                      </div>
                    </td>
                    <td>
                      <input
                        type="date"
                        aria-label={`Novo fim do acesso de ${f.user.name}`}
                        min={todayIso()}
                        value={value}
                        onChange={(e) => setDates((prev) => ({ ...prev, [f.id]: e.target.value }))}
                      />
                    </td>
                    <td>
                      <div className="form-actions">
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={busy === f.id || !value || value === isoDay(f.access_expires_at)}
                          onClick={() => void change(f.id, { access_until: value })}
                        >
                          {f.active ? "Mudar prazo" : "Renovar"}
                        </Button>
                        {f.active && (
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={busy === f.id}
                            onClick={() => void change(f.id, { end_now: true })}
                          >
                            Encerrar agora
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
