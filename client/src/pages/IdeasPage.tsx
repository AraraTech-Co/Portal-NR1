import { useState } from "react";
import { useResourceList } from "@/hooks/useResourceList";
import { createIdea, decideIdea, fetchIdeas } from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { NewRecordSection } from "@/components/NewRecordSection";
import { formatDay, IDEA_STATUS_LABEL } from "@/lib/labels";
import { useModuleAccess } from "@/lib/module-access";

/** A cor diz o que aconteceu com a ideia sem precisar ler. */
function tom(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "IMPLEMENTED") return "success";
  if (status === "NEW") return "warning";
  if (status === "REJECTED") return "danger";
  return "neutral";
}

/**
 * Ideias: enviar e responder.
 *
 * A tela recebia a ideia e não havia como respondê-la — a rota de decidir
 * existia no servidor e tela nenhuma a usava. A ideia ficava em "Nova" para
 * sempre, e o Início do RH contava "ideias sem resposta" que não havia onde
 * responder. [CB-64] [OB-4]
 */
export function IdeasPage() {
  const { rows, loading, error, reload } = useResourceList(fetchIdeas);
  /* Ideia é de quem faz o trabalho: escrever basta. [OB-4] */
  const { canWrite, canManage } = useModuleAccess("ideias");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [resposta, setResposta] = useState<Record<string, string>>({});
  const [decidindo, setDecidindo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  /*
    Pôr em análise é só avisar que alguém pegou a ideia; implantar ou recusar
    é uma resposta, e sem ela quem propôs fica sabendo o fim e não o porquê.
    O servidor recusa as duas últimas sem nota (400): a tela diz antes, em
    vez de mandar o erro de volta. [CB-64]
  */
  async function decidir(id: string, status: string) {
    const nota = resposta[id]?.trim() ?? "";
    if ((status === "IMPLEMENTED" || status === "REJECTED") && !nota) {
      setErro(
        "Escreva a resposta antes de implantar ou recusar: é o que quem teve a ideia vai ler.",
      );
      return;
    }
    setDecidindo(id);
    setErro(null);
    try {
      await decideIdea(id, { status, decision_note: nota || undefined });
      setResposta((r) => ({ ...r, [id]: "" }));
      reload();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao responder");
    } finally {
      setDecidindo(null);
    }
  }

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
      <>
        {erro && (
          <p className="page-error" role="alert">
            {erro}
          </p>
        )}
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                  <th>A ideia</th>
                  <th>Quem teve</th>
                  <th>Situação</th>
                  <th>Criado em</th>
                  {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                    <td>
                      <strong>{r.title}</strong>
                      {/* Sem isto, quem responde decidia pelo título. */}
                      <div className="muted">{r.description}</div>
                    </td>
                    <td>{r.author.name}</td>
                    <td>
                      <Chip tone={tom(r.status)}>
                        {IDEA_STATUS_LABEL[r.status] ?? r.status}
                      </Chip>
                      {/* A resposta aparece para quem teve a ideia. */}
                      {r.decisionNote && (
                        <div className="muted">{r.decisionNote}</div>
                      )}
                      {r.decidedBy && (
                        <div className="muted">
                          por {r.decidedBy.name}
                          {r.decidedAt ? ` em ${formatDay(r.decidedAt)}` : ""}
                        </div>
                      )}
                    </td>
                    <td>{formatDay(r.createdAt)}</td>
                    {canManage && (
                      <td>
                        <div className="form-grid">
                          <input
                            value={resposta[r.id] ?? ""}
                            onChange={(e) =>
                              setResposta((m) => ({
                                ...m,
                                [r.id]: e.target.value,
                              }))
                            }
                            placeholder="Resposta (obrigatória ao implantar ou recusar)"
                          />
                          <div className="form-actions">
                            {r.status === "NEW" && (
                              <Button
                                type="button"
                                variant="secondary"
                                disabled={decidindo === r.id}
                                onClick={() => void decidir(r.id, "IN_ANALYSIS")}
                              >
                                Pôr em análise
                              </Button>
                            )}
                            <Button
                              type="button"
                              disabled={decidindo === r.id}
                              onClick={() => void decidir(r.id, "IMPLEMENTED")}
                            >
                              Implantar
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={decidindo === r.id}
                              onClick={() => void decidir(r.id, "REJECTED")}
                            >
                              Recusar
                            </Button>
                          </div>
                        </div>
                      </td>
                    )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    </ListShell>
  );
}
