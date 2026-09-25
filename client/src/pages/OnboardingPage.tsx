import { useResourceList } from "@/hooks/useResourceList";
import { fetchOnboardingSteps } from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { Chip } from "@/components/Chip";

export function OnboardingPage() {
  const { rows, loading, error } = useResourceList(fetchOnboardingSteps);

  return (
    <ListShell
      title="Onboarding"
      description="Passos de integração do colaborador."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhum passo"
      emptyDescription="O RH define os passos de onboarding da organização."
    >
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
                <th>Ordem</th>
                <th>Título</th>
                <th>Descrição</th>
                <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                  <td>{r.order}</td>
                  <td><strong>{r.title}</strong></td>
                  <td>{r.description ?? "—"}</td>
                  <td>{r.done_at ? <Chip tone="success">Concluído</Chip> : <Chip tone="warning">Pendente</Chip>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ListShell>
  );
}
