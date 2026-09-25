import { useResourceList } from "@/hooks/useResourceList";
import { fetchSummons } from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { formatDay } from "@/lib/labels";

export function SummonsPage() {
  const { rows, loading, error } = useResourceList(fetchSummons);

  return (
    <ListShell
      title="Convocações"
      description="Convocações e confirmação de presença."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhuma convocação"
      emptyDescription="Convocações do RH aparecem nesta lista."
    >
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
                <th>Título</th>
                <th>Quando</th>
                <th>Criado por</th>
                <th>Convocados</th>
                <th>Minha presença</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                  <td><strong>{r.title}</strong></td>
                  <td>{formatDay(r.scheduledFor)}</td>
                  <td>{r.createdBy.name}</td>
                  <td>{r._count.attendances}</td>
                  <td>{r.my_attendance?.status ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ListShell>
  );
}
