import { useResourceList } from "@/hooks/useResourceList";
import { fetchTimeEntries } from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { formatDay } from "@/lib/labels";

export function TimeEntriesPage() {
  const { rows, loading, error } = useResourceList(fetchTimeEntries);

  return (
    <ListShell
      title="Banco de horas"
      description="Lançamentos de ponto e saldo diário."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhum lançamento"
      emptyDescription="Registros de ponto dos últimos dias aparecem aqui."
    >
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
                <th>Dia</th>
                <th>Saldo (min)</th>
                <th>Nota</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                  <td>{formatDay(r.day)}</td>
                  <td>{r.balanceMinutes}</td>
                  <td>{r.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ListShell>
  );
}
