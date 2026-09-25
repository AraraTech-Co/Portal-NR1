import { useResourceList } from "@/hooks/useResourceList";
import { fetchHrDocuments } from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { Chip } from "@/components/Chip";
import { formatDay } from "@/lib/labels";

export function HrDocumentsPage() {
  const { rows, loading, error } = useResourceList(fetchHrDocuments);

  return (
    <ListShell
      title="Documentos"
      description="Políticas e documentos de RH com ciência do colaborador."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhum documento"
      emptyDescription="Documentos publicados pelo RH aparecem aqui."
    >
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
                <th>Título</th>
                <th>Tipo</th>
                <th>Destino</th>
                <th>Publicado por</th>
                <th>Ciências</th>
                <th>Minha ciência</th>
                <th>Criado em</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                  <td><strong>{r.title}</strong></td>
                  <td>{r.kind}</td>
                  <td>{r.target?.name ?? "Todos"}</td>
                  <td>{r.publishedBy.name}</td>
                  <td>{r._count.acks}</td>
                  <td>{r.my_ack?.acknowledgedAt ? <Chip tone="success">OK</Chip> : <Chip tone="warning">Pendente</Chip>}</td>
                  <td>{formatDay(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ListShell>
  );
}
