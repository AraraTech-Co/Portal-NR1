import { useState } from "react";
import { useResourceList } from "@/hooks/useResourceList";
import {
  completeOnboardingStep,
  createOnboardingStep,
  fetchOnboardingSteps,
} from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { NewRecordSection } from "@/components/NewRecordSection";
import { formatDay } from "@/lib/labels";
import { useModuleAccess } from "@/lib/module-access";
import "./onboarding.css";

/**
 * Onboarding: o roteiro de quem chega.
 *
 * A tela criava passos e ninguém os marcava como feitos — a rota existia no
 * servidor desde o começo e tela nenhuma a usava, então o roteiro ficava
 * "Pendente" para sempre. O progresso é de quem marca: cada pessoa vê o
 * próprio. [CB-64] [OB-4]
 */
export function OnboardingPage() {
  const { rows, loading, error, reload } = useResourceList(fetchOnboardingSteps);
  const { canWrite } = useModuleAccess("onboarding");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [marcando, setMarcando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function marcarFeito(id: string) {
    setMarcando(id);
    setErro(null);
    try {
      await completeOnboardingStep(id);
      reload();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao marcar o passo");
    } finally {
      setMarcando(null);
    }
  }

  return (
    <ListShell
      title="Onboarding"
      description="Passos de integração de quem chega. Cada pessoa marca os próprios passos."
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
      <>
        {erro && (
          <p className="page-error" role="alert">
            {erro}
          </p>
        )}
        <div className="data-table-wrap">
          <table className="data-table onboarding-table">
            <thead>
              <tr>
                  <th className="onboarding-col-ordem">Ordem</th>
                  <th>Título</th>
                  <th className="onboarding-col-descricao">Descrição</th>
                  {/* A situação é a de quem está olhando, não a da turma
                      inteira: o servidor guarda o progresso por pessoa. */}
                  <th>Meu passo</th>
                  <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                    <td className="onboarding-col-ordem">{r.order}</td>
                    <td>
                      <strong>{r.title}</strong>
                      {/* No celular a coluna da descrição sai: o texto entra
                          aqui, para o botão caber na tela. */}
                      {r.description && (
                        <div className="muted onboarding-descricao-embaixo">
                          {r.description}
                        </div>
                      )}
                    </td>
                    <td className="onboarding-col-descricao">
                      {r.description ?? "—"}
                    </td>
                    <td>
                      {r.done_at ? (
                        <>
                          <Chip tone="success">Feito</Chip>
                          <div className="muted">{formatDay(r.done_at)}</div>
                        </>
                      ) : (
                        <Chip tone="warning">A fazer</Chip>
                      )}
                    </td>
                    <td>
                      {!r.done_at && (
                        <Button
                          type="button"
                          disabled={marcando === r.id}
                          onClick={() => void marcarFeito(r.id)}
                        >
                          {marcando === r.id ? "Marcando…" : "Marquei como feito"}
                        </Button>
                      )}
                    </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    </ListShell>
  );
}
