import { useResourceList } from "@/hooks/useResourceList";
import { fetchMedicalCertificates } from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { Chip } from "@/components/Chip";
import { formatDay } from "@/lib/labels";

export function MedicalCertificatesPage() {
  const { rows, loading, error } = useResourceList(fetchMedicalCertificates);

  return (
    <ListShell
      title="Atestados"
      description="Atestados médicos enviados e em análise."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhum atestado"
      emptyDescription="Atestados enviados pelos colaboradores aparecem aqui."
    >
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
                <th>Colaborador</th>
                <th>Status</th>
                <th>Início</th>
                <th>Dias</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                  <td>{r.user.name}</td>
                  <td><Chip>{r.status}</Chip></td>
                  <td>{formatDay(r.startDate)}</td>
                  <td>{r.days}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ListShell>
  );
}
