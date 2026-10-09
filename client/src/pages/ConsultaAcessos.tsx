import { useEffect, useState } from "react";
import { request } from "@/api/client";

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
