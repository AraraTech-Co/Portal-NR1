import { useResourceList } from "@/hooks/useResourceList";
import { fetchIdeas } from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { Chip } from "@/components/Chip";
import { formatDay } from "@/lib/labels";

export function IdeasPage() {
  const { rows, loading, error } = useResourceList(fetchIdeas);

  return (
    <ListShell
      title="Ideias"
      description="Sugestões enviadas pelos colaboradores."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhuma ideia"
      emptyDescription="Ideias enviadas aparecem nesta lista."
    >
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
                <th>Título</th>
                <th>Autor</th>
                <th>Status</th>
                <th>Criado em</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                  <td><strong>{r.title}</strong></td>
                  <td>{r.author.name}</td>
                  <td><Chip>{r.status}</Chip></td>
                  <td>{formatDay(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ListShell>
  );
}
