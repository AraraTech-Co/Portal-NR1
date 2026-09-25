import { useResourceList } from "@/hooks/useResourceList";
import { fetchEmployeeProfiles } from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { formatDay } from "@/lib/labels";

export function EmployeesPage() {
  const { rows, loading, error } = useResourceList(fetchEmployeeProfiles);

  return (
    <ListShell
      title="Colaboradores"
      description="Perfis de colaboradores vinculados à organização."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhum colaborador"
      emptyDescription="Perfis de RH aparecem quando cadastrados."
    >
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
                <th>Nome</th>
                <th>Login</th>
                <th>Função</th>
                <th>Matrícula</th>
                <th>Admissão</th>
                <th>Desligamento</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                  <td><strong>{r.user.name}</strong></td>
                  <td>{r.user.login}</td>
                  <td>{r.jobRole?.name ?? "—"}</td>
                  <td>{r.registration ?? "—"}</td>
                  <td>{formatDay(r.admittedAt)}</td>
                  <td>{formatDay(r.dismissedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ListShell>
  );
}
