import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import {
  fetchEmployees,
  WORKER_BOND_LABEL,
  type EmployeeRow,
} from "@/api/people";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { formatDay } from "@/lib/labels";
import { isReadOnlyPermission, useModuleAccess } from "@/lib/module-access";
import "@/components/data-table.css";
import "@/components/form.css";
import "./people.css";

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Quem trabalha aqui: lista, busca e a porta para a ficha de cada um.
 * Desligado some da lista por padrão, mas nunca do registro. [S5-H] [S6-C]
 */
export function EmployeesPage() {
  const { user } = useAuth();
  const { canManage } = useModuleAccess("colaboradores");
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [incluirDesligados, setIncluirDesligados] = useState(false);
  const [busca, setBusca] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setRows(await fetchEmployees(incluirDesligados));
  }, [incluirDesligados]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    reload()
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Falha ao carregar");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const filtradas = useMemo(() => {
    const termo = semAcento(busca.trim());
    if (!termo) return rows;
    return rows.filter((r) =>
      [
        r.user.name,
        r.user.login,
        r.registration ?? "",
        r.jobRole?.name ?? "",
        WORKER_BOND_LABEL[r.bond] ?? "",
        r.contractor?.name ?? "",
      ].some((campo) =>
        semAcento(campo).includes(termo),
      ),
    );
  }, [rows, busca]);

  const desligados = rows.filter((r) => r.dismissedAt).length;

  return (
    <div>
      <PageHeader
        title="Colaboradores"
        description={
          canManage
            ? "Quem trabalha na empresa. Abra a ficha para ver função, treinamentos, ordem de serviço e registrar o desligamento."
            : /*
                A consulta vê a lista inteira, não a própria ficha: dizer
                "sua ficha" numa tela com nove pessoas é descrever outra
                tela. [CB-43]
              */
              isReadOnlyPermission(user?.permission)
              ? "Quem trabalha na empresa: nome, matrícula, função e admissão. Sem CPF, contato nem motivo de desligamento."
              : "Sua ficha na empresa."
        }
      />

      {canManage && (
        <div className="people-filters">
          <label className="form-field">
            Buscar
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Nome, login, matrícula ou função"
            />
          </label>
          <label className="people-check">
            <input
              type="checkbox"
              checked={incluirDesligados}
              onChange={(e) => setIncluirDesligados(e.target.checked)}
            />
            Mostrar quem já saiu
            {incluirDesligados && desligados > 0 && (
              <span className="muted"> · {desligados} desligado(s)</span>
            )}
          </label>
        </div>
      )}

      {loading && <LoadingState label="Carregando colaboradores…" />}
      {!loading && error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && rows.length === 0 && (
        <EmptyState
          title="Nenhum colaborador"
          description="As fichas aparecem aqui quando o RH cadastra as pessoas."
        />
      )}
      {!loading && !error && rows.length > 0 && filtradas.length === 0 && (
        <EmptyState
          title="Ninguém com esse termo"
          description="Tente outro nome, login, matrícula ou função."
        />
      )}

      {!loading && !error && filtradas.length > 0 && (
        <section className="form-section">
          <h2>
            {filtradas.length === 1 ? "1 pessoa" : `${filtradas.length} pessoas`}
          </h2>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Função</th>
                  <th>Vínculo</th>
                  <th>Matrícula</th>
                  <th>Situação</th>
                  <th aria-label="Ficha" />
                </tr>
              </thead>
              <tbody>
                {filtradas.map((r) => (
                  <tr key={r.id} className={r.dismissedAt ? "is-dismissed" : undefined}>
                    <td>
                      <strong>{r.user.name}</strong>
                      <div className="muted">{r.user.login}</div>
                    </td>
                    <td>{r.jobRole?.name ?? <span className="muted">sem função</span>}</td>
                    <td>
                      {r.bond === "EMPLOYEE" ? (
                        <span className="muted">{WORKER_BOND_LABEL.EMPLOYEE}</span>
                      ) : (
                        <Chip tone="info">
                          {WORKER_BOND_LABEL[r.bond] ?? r.bond}
                        </Chip>
                      )}
                      {r.contractor && <div className="muted">{r.contractor.name}</div>}
                    </td>
                    <td>{r.registration ?? <span className="muted">—</span>}</td>
                    <td>
                      {r.dismissedAt ? (
                        <>
                          <Chip tone="neutral">Desligado</Chip>
                          <div className="muted">em {formatDay(r.dismissedAt)}</div>
                        </>
                      ) : (
                        <>
                          <Chip tone="success">Ativo</Chip>
                          {r.admittedAt && (
                            <div className="muted">desde {formatDay(r.admittedAt)}</div>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      <Link to={`/colaboradores/${r.id}`}>Abrir ficha</Link>
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
