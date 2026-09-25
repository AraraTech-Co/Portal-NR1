import { useResourceList } from "@/hooks/useResourceList";
import { fetchLeaves } from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { Chip } from "@/components/Chip";
import { formatDay } from "@/lib/labels";

export function LeavesPage() {
  const { rows, loading, error } = useResourceList(fetchLeaves);

  return (
    <ListShell
      title="Férias e licenças"
      description="Solicitações de férias, afastamentos e licenças."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhuma solicitação"
      emptyDescription="Pedidos de férias e licenças aparecem nesta lista."
    >
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
                <th>Colaborador</th>
                <th>Tipo</th>
                <th>Status</th>
                <th>Início</th>
                <th>Fim</th>
                <th>Dias</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                  <td>{r.user.name}</td>
                  <td>{r.kind}</td>
                  <td><Chip>{r.status}</Chip></td>
                  <td>{formatDay(r.startDate)}</td>
                  <td>{formatDay(r.endDate)}</td>
                  <td>{r.days}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ListShell>
  );
}
