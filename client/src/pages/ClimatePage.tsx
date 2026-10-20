import { useState } from "react";
import { useResourceList } from "@/hooks/useResourceList";
import { createClimateSurvey, fetchClimateSurveys } from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { Chip } from "@/components/Chip";
import { NewRecordSection } from "@/components/NewRecordSection";
import { formatDay, SURVEY_STATUS_LABEL } from "@/lib/labels";
import { useModuleAccess } from "@/lib/module-access";

export function ClimatePage() {
  const { rows, loading, error, reload } = useResourceList(fetchClimateSurveys);
  /*
    Montar pesquisa é de quem cuida do módulo; o colaborador escreve em
    clima para RESPONDER, e o servidor já exige administração aqui.
  */
  const { canManage } = useModuleAccess("clima");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [perguntas, setPerguntas] = useState("");

  return (
    <ListShell
      title="Clima organizacional"
      description="Pesquisas de clima abertas ou gerenciadas pelo RH."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhuma pesquisa"
      emptyDescription="Pesquisas de clima aparecem quando publicadas."
      before={
        <NewRecordSection
          canWrite={canManage}
          openLabel="Nova pesquisa"
          title="Nova pesquisa de clima"
          description="Nasce como rascunho: dá para revisar antes de abrir para respostas. A resposta é anônima."
          submitLabel="Criar rascunho"
          disabled={!title.trim()}
          onSubmit={async () => {
            const questions = perguntas
              .split("\n")
              .map((p) => p.trim())
              .filter(Boolean)
              .map((prompt, i) => ({ order: i + 1, prompt }));
            await createClimateSurvey({
              title: title.trim(),
              description: description.trim() || undefined,
              questions,
            });
            setTitle("");
            setDescription("");
            setPerguntas("");
            await reload();
            return "Pesquisa criada como rascunho.";
          }}
        >
          <label className="form-field">
            Título
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label className="form-field">
            Para que serve (opcional)
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="form-field">
            Perguntas, uma por linha
            <textarea
              value={perguntas}
              onChange={(e) => setPerguntas(e.target.value)}
              placeholder={"Como você avalia a carga de trabalho?\nVocê se sente respeitado no dia a dia?"}
            />
          </label>
        </NewRecordSection>
      }
    >
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
                <th>Título</th>
                <th>Status</th>
                <th>Respostas</th>
                <th>Criado em</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                  <td><strong>{r.title}</strong></td>
                  <td>
                    <Chip>{SURVEY_STATUS_LABEL[r.status] ?? r.status}</Chip>
                  </td>
                  <td>{r._count?.responses ?? 0}</td>
                  <td>{formatDay(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ListShell>
  );
}
