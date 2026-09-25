import { useResourceList } from "@/hooks/useResourceList";
import { fetchEthicsReports } from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { Chip } from "@/components/Chip";
import { formatDay } from "@/lib/labels";

export function EthicsPage() {
  const { rows, loading, error } = useResourceList(fetchEthicsReports);

  return (
    <ListShell
      title="Canal de denúncia"
      description="Relatos recebidos pelo comitê de ética."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhum relato"
      emptyDescription="Relatos do canal de denúncia aparecem para o comitê."
    >
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
                <th>Protocolo</th>
                <th>Categoria</th>
                <th>Status</th>
                <th>Anônimo</th>
                <th>Estabelecimento</th>
                <th>Mensagens</th>
                <th>Criado em</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                  <td><strong>{r.protocol}</strong></td>
                  <td>{r.category}</td>
                  <td><Chip>{r.status}</Chip></td>
                  <td>{r.isAnonymous ? "Sim" : "Não"}</td>
                  <td>{r.establishment?.name ?? "—"}</td>
                  <td>{r._count.messages}</td>
                  <td>{formatDay(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ListShell>
  );
}
