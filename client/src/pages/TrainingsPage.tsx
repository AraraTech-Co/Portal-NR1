import { useResourceList } from "@/hooks/useResourceList";
import { fetchTrainings } from "@/api/modules";
import { ListShell } from "@/components/ListShell";

export function TrainingsPage() {
  const { rows, loading, error } = useResourceList(fetchTrainings);

  return (
    <ListShell
      title="Treinamentos"
      description="Catálogo de treinamentos da organização."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhum treinamento"
      emptyDescription="Treinamentos publicados pelo RH aparecem aqui."
    >
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
                <th>Título</th>
                <th>Categoria</th>
                <th>Duração (min)</th>
                <th>Inscrições</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                  <td><strong>{r.title}</strong></td>
                  <td>{r.category}</td>
                  <td>{r.durationMinutes}</td>
                  <td>{r._count?.enrollments ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ListShell>
  );
}
