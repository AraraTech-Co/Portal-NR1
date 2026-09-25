import { useResourceList } from "@/hooks/useResourceList";
import { fetchContractors } from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { formatDay } from "@/lib/labels";

export function ContractorsPage() {
  const { rows, loading, error } = useResourceList(fetchContractors);

  return (
    <ListShell
      title="Terceiros"
      description="Empresas e prestadores com documentos e riscos informados."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhum terceiro cadastrado"
      emptyDescription="Cadastre contratadas e acompanhe o recebimento de documentos."
    >
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
                <th>Nome</th>
                <th>Relação</th>
                <th>Estabelecimento</th>
                <th>Docs recebidos</th>
                <th>Riscos informados</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                  <td><strong>{r.name}</strong></td>
                  <td>{r.relation}</td>
                  <td>{r.establishment?.name ?? "—"}</td>
                  <td>{formatDay(r.documentsReceivedAt)}</td>
                  <td>{formatDay(r.risksInformedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ListShell>
  );
}
