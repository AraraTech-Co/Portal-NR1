import { useResourceList } from "@/hooks/useResourceList";
import { fetchParticipations } from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { formatDay } from "@/lib/labels";

export function ParticipationsPage() {
  const { rows, loading, error } = useResourceList(fetchParticipations);

  return (
    <ListShell
      title="Participação"
      description="Registros de participação dos trabalhadores no GRO."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhum registro"
      emptyDescription="DDS, reuniões e consultas aparecem nesta lista."
    >
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
                <th>Tipo</th>
                <th>Assunto</th>
                <th>Estabelecimento</th>
                <th>Data</th>
                <th>Evidências</th>
                <th>Registrado por</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                  <td>{r.type}</td>
                  <td><strong>{r.subject}</strong></td>
                  <td>{r.establishment?.name ?? "—"}</td>
                  <td>{formatDay(r.occurredAt)}</td>
                  <td>{r._count.evidences}</td>
                  <td>{r.recordedBy.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ListShell>
  );
}
