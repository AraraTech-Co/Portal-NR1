import { useResourceList } from "@/hooks/useResourceList";
import { fetchClimateSurveys } from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { Chip } from "@/components/Chip";
import { formatDay } from "@/lib/labels";

export function ClimatePage() {
  const { rows, loading, error } = useResourceList(fetchClimateSurveys);

  return (
    <ListShell
      title="Clima organizacional"
      description="Pesquisas de clima abertas ou gerenciadas pelo RH."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhuma pesquisa"
      emptyDescription="Pesquisas de clima aparecem quando publicadas."
    >
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
                <th>Título</th>
                <th>Status</th>
                <th>Respostas</th>
                <th>Criado em</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                  <td><strong>{r.title}</strong></td>
                  <td><Chip>{r.status}</Chip></td>
                  <td>{r._count?.responses ?? 0}</td>
                  <td>{formatDay(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ListShell>
  );
}
