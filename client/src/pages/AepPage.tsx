import { useResourceList } from "@/hooks/useResourceList";
import { fetchAeps } from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { Chip } from "@/components/Chip";
import { formatDay } from "@/lib/labels";

export function AepPage() {
  const { rows, loading, error } = useResourceList(fetchAeps);

  return (
    <ListShell
      title="Avaliação ergonômica"
      description="AEP e fatores psicossociais por estabelecimento e setor."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhuma AEP registrada"
      emptyDescription="Quando houver avaliações ergonômicas, elas aparecem aqui."
    >
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
                <th>Estabelecimento</th>
                <th>Setor</th>
                <th>Método</th>
                <th>Status</th>
                <th>Data</th>
                <th>Perigos</th>
                <th>Responsável</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                  <td>{r.establishment.name}</td>
                  <td>{r.sector?.name ?? "—"}</td>
                  <td>{r.method}</td>
                  <td><Chip tone={r.status === "CONCLUDED" ? "success" : "warning"}>{r.status}</Chip></td>
                  <td>{formatDay(r.conductedAt)}</td>
                  <td>{r._count.hazards}</td>
                  <td>{r.conductedBy.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ListShell>
  );
}
