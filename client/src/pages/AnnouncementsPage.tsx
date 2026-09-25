import { useResourceList } from "@/hooks/useResourceList";
import { fetchAnnouncements } from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { Chip } from "@/components/Chip";
import { formatDay } from "@/lib/labels";

export function AnnouncementsPage() {
  const { rows, loading, error } = useResourceList(fetchAnnouncements);

  return (
    <ListShell
      title="Mural de avisos"
      description="Comunicados internos da organização."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhum aviso"
      emptyDescription="Avisos publicados pelo RH aparecem no mural."
    >
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
                <th>Título</th>
                <th>Publicado por</th>
                <th>Leituras</th>
                <th>Lido</th>
                <th>Publicado em</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                  <td><strong>{r.title}</strong></td>
                  <td>{r.publishedBy.name}</td>
                  <td>{r._count.reads}</td>
                  <td>{r.read_at ? <Chip tone="success">Sim</Chip> : <Chip tone="warning">Não</Chip>}</td>
                  <td>{formatDay(r.publishedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ListShell>
  );
}
