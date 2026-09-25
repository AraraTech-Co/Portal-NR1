import { useResourceList } from "@/hooks/useResourceList";
import { fetchReferrals } from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { Chip } from "@/components/Chip";
import { formatDay } from "@/lib/labels";

export function ReferralsPage() {
  const { rows, loading, error } = useResourceList(fetchReferrals);

  return (
    <ListShell
      title="Banco de talentos"
      description="Indicações de candidatos."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhuma indicação"
      emptyDescription="Indique candidatos ou acompanhe as indicações do RH."
    >
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
                <th>Candidato</th>
                <th>Vaga</th>
                <th>Status</th>
                <th>Criado em</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                  <td><strong>{r.candidateName}</strong></td>
                  <td>{r.position}</td>
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
