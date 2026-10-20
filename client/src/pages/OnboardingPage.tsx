import { useState } from "react";
import { useResourceList } from "@/hooks/useResourceList";
import { createOnboardingStep, fetchOnboardingSteps } from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { Chip } from "@/components/Chip";
import { NewRecordSection } from "@/components/NewRecordSection";
import { useModuleAccess } from "@/lib/module-access";

export function OnboardingPage() {
  const { rows, loading, error, reload } = useResourceList(fetchOnboardingSteps);
  const { canWrite } = useModuleAccess("onboarding");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  return (
    <ListShell
      title="Onboarding"
      description="Passos de integração do colaborador."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhum passo"
      emptyDescription="O RH define os passos de onboarding da organização."
      before={
        <NewRecordSection
          canWrite={canWrite}
          openLabel="Novo passo"
          title="Novo passo da integração"
          description="A ordem é a da lista: o passo novo entra no fim."
          submitLabel="Adicionar passo"
          disabled={!title.trim()}
          onSubmit={async () => {
            await createOnboardingStep({
              order: rows.length + 1,
              title: title.trim(),
              description: description.trim() || undefined,
            });
            setTitle("");
            setDescription("");
            await reload();
            return "Passo adicionado ao roteiro.";
          }}
        >
          <label className="form-field">
            O que a pessoa faz neste passo
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label className="form-field">
            Detalhe (opcional)
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </NewRecordSection>
      }
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
