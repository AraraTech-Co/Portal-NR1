import { useState } from "react";
import { useResourceList } from "@/hooks/useResourceList";
import { createIdea, fetchIdeas } from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { Chip } from "@/components/Chip";
import { NewRecordSection } from "@/components/NewRecordSection";
import { formatDay, IDEA_STATUS_LABEL } from "@/lib/labels";
import { useModuleAccess } from "@/lib/module-access";

export function IdeasPage() {
  const { rows, loading, error, reload } = useResourceList(fetchIdeas);
  /* Ideia é de quem faz o trabalho: escrever basta. [OB-4] */
  const { canWrite } = useModuleAccess("ideias");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  return (
    <ListShell
      title="Ideias"
      description="Sugestões enviadas pelos colaboradores."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhuma ideia"
      emptyDescription="Ideias enviadas aparecem nesta lista."
      before={
        <NewRecordSection
          canWrite={canWrite}
          openLabel="Enviar uma ideia"
          title="Sua ideia"
          description="O que daria para fazer melhor, mais seguro ou mais simples no seu trabalho."
          submitLabel="Enviar"
          disabled={!title.trim() || !description.trim()}
          onSubmit={async () => {
            await createIdea({ title: title.trim(), description: description.trim() });
            setTitle("");
            setDescription("");
            await reload();
            return "Ideia enviada. Quem cuida do módulo vai analisar.";
          }}
        >
          <label className="form-field">
            Em uma linha, qual é a ideia
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required />
          </label>
          <label className="form-field">
            Como funcionaria
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="O que muda, onde, e o que melhora."
              required
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
                <th>Autor</th>
                <th>Status</th>
                <th>Criado em</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                  <td><strong>{r.title}</strong></td>
                  <td>{r.author.name}</td>
                  <td><Chip>{IDEA_STATUS_LABEL[r.status] ?? r.status}</Chip></td>
                  <td>{formatDay(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ListShell>
  );
}
