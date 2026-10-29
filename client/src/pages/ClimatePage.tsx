import { useState } from "react";
import { useResourceList } from "@/hooks/useResourceList";
import {
  closeClimateSurvey,
  createClimateSurvey,
  fetchClimateSurvey,
  fetchClimateSurveys,
  openClimateSurvey,
  respondClimateSurvey,
} from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { NewRecordSection } from "@/components/NewRecordSection";
import { formatDay, SURVEY_STATUS_LABEL } from "@/lib/labels";
import { useModuleAccess } from "@/lib/module-access";
import "@/components/form.css";
import "./climate.css";

type Pesquisa = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  isAnonymous: boolean;
  questions: Array<{ id: string; order: number; prompt: string }>;
};

/**
 * A escala da nota.
 *
 * As perguntas são escritas pelo RH e podem ser sobre qualquer coisa ("como
 * você avalia a carga de trabalho?"). A nota precisa dizer para que lado é
 * melhor, ou cada pessoa inventa a sua. [CB-64]
 */
const ESCALA: Record<number, string> = {
  1: "muito ruim",
  2: "ruim",
  3: "regular",
  4: "bom",
  5: "muito bom",
};

function tom(status: string): "success" | "warning" | "neutral" {
  if (status === "OPEN") return "success";
  if (status === "DRAFT") return "warning";
  return "neutral";
}

/**
 * Clima organizacional: montar, abrir, responder e encerrar.
 *
 * A tela criava a pesquisa como rascunho e parava aí: não havia como abri-la
 * para respostas, responder nem encerrá-la — as rotas existiam no servidor e
 * tela nenhuma as usava. O rascunho ficava rascunho, e quem respondia não
 * tinha por onde. [CB-64] [OB-4]
 */
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

  const [mudando, setMudando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [respondendo, setRespondendo] = useState<Pesquisa | null>(null);
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [comentarios, setComentarios] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);

  async function mudarSituacao(id: string, acao: "abrir" | "encerrar") {
    setMudando(id);
    setErro(null);
    setAviso(null);
    try {
      if (acao === "abrir") await openClimateSurvey(id);
      else await closeClimateSurvey(id);
      if (acao === "encerrar" && respondendo?.id === id) setRespondendo(null);
      reload();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao mudar a pesquisa");
    } finally {
      setMudando(null);
    }
  }

  /* As perguntas não vêm na lista: quem vai responder precisa delas. */
  async function abrirParaResponder(id: string) {
    setMudando(id);
    setErro(null);
    setAviso(null);
    try {
      const pesquisa = await fetchClimateSurvey(id);
      setNotas({});
      setComentarios({});
      setRespondendo(pesquisa);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao abrir a pesquisa");
    } finally {
      setMudando(null);
    }
  }

  async function enviarRespostas() {
    if (!respondendo) return;
    const answers = respondendo.questions
      .map((q) => ({
        question_id: q.id,
        score: notas[q.id] ? Number(notas[q.id]) : undefined,
        text: comentarios[q.id]?.trim() || undefined,
      }))
      .filter((a) => a.score !== undefined || a.text !== undefined);

    /*
      Sem nenhuma resposta o servidor devolve 400: a tela diz antes, em vez
      de mandar o erro de volta para quem se dispôs a responder.
    */
    if (answers.length === 0) {
      setErro("Responda ao menos uma pergunta antes de enviar.");
      return;
    }

    setEnviando(true);
    setErro(null);
    try {
      await respondClimateSurvey(respondendo.id, answers);
      setAviso(
        respondendo.isAnonymous
          ? "Resposta enviada. Ela não ficou vinculada ao seu nome."
          : "Resposta enviada.",
      );
      setRespondendo(null);
      reload();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao enviar");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ListShell
      title="Clima organizacional"
      description="Pesquisas de clima: montar, abrir para respostas, responder e encerrar."
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
          description="Nasce como rascunho: dá para revisar antes de abrir para respostas. A resposta é anônima, e por isso o portal conta respostas, não pessoas."
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
      <>
        {erro && (
          <p className="page-error" role="alert">
            {erro}
          </p>
        )}
        {aviso && (
          <p className="form-hint" role="status">
            {aviso}
          </p>
        )}

        {respondendo && (
          <section className="form-section">
            <h2>{respondendo.title}</h2>
            {respondendo.description && (
              <p className="muted">{respondendo.description}</p>
            )}
            <p className="muted">
              {respondendo.isAnonymous
                ? "A resposta é anônima: o portal não guarda quem respondeu."
                : "Esta pesquisa não é anônima: a resposta fica vinculada ao seu nome."}
            </p>
            {respondendo.questions.length === 0 ? (
              /* Pesquisa aberta sem pergunta: dizer, em vez de mostrar um
                 formulário vazio com um botão que não faz nada. */
              <p className="form-hint">
                Esta pesquisa foi aberta sem nenhuma pergunta. Avise quem
                cuida do módulo.
              </p>
            ) : (
              <div className="form-grid">
                {respondendo.questions.map((q) => (
                  <div className="form-field" key={q.id}>
                    <label htmlFor={`nota-${q.id}`}>
                      {q.order}. {q.prompt}
                    </label>
                    <select
                      id={`nota-${q.id}`}
                      value={notas[q.id] ?? ""}
                      onChange={(e) =>
                        setNotas((n) => ({ ...n, [q.id]: e.target.value }))
                      }
                    >
                      <option value="">Prefiro não dar nota</option>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={String(n)}>
                          {n} — {ESCALA[n]}
                        </option>
                      ))}
                    </select>
                    <input
                      value={comentarios[q.id] ?? ""}
                      onChange={(e) =>
                        setComentarios((c) => ({ ...c, [q.id]: e.target.value }))
                      }
                      placeholder="Quer explicar? (opcional)"
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="form-actions">
              <Button
                type="button"
                disabled={enviando || respondendo.questions.length === 0}
                onClick={() => void enviarRespostas()}
              >
                {enviando ? "Enviando…" : "Enviar resposta"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setRespondendo(null)}
              >
                Fechar
              </Button>
            </div>
          </section>
        )}

        {/* Na anônima, o portal não guarda quem respondeu e, por isso, não
            impede a mesma pessoa de responder de novo: a contagem é de
            respostas. Impedir exigiria guardar quem respondeu. Uma vez,
            acima da tabela: a coluna da contagem some no celular. [CB-64] */}
        {canManage && rows.some((r) => r.isAnonymous) && (
          <p className="form-hint climate-nota">
            Nas pesquisas anônimas, o número é de respostas, não de pessoas: o
            portal não guarda quem respondeu, e a mesma pessoa pode ter
            respondido mais de uma vez.
          </p>
        )}

        <div className="data-table-wrap">
          <table className="data-table climate-table">
            <thead>
              <tr>
                  <th>Pesquisa</th>
                  <th>Situação</th>
                  {/* Uma coluna só: com seis, o botão de abrir saía cortado
                      na borda da tabela mesmo no computador. */}
                  <th className="climate-col-extra">Perguntas e respostas</th>
                  <th className="climate-col-extra">Criada em</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                    <td>
                      <strong>{r.title}</strong>
                      {r.description && (
                        <div className="muted">{r.description}</div>
                      )}
                    </td>
                    <td>
                      <Chip tone={tom(r.status)}>
                        {SURVEY_STATUS_LABEL[r.status] ?? r.status}
                      </Chip>
                      {/* Os botões junto da situação: numa coluna à parte
                          eles ficavam fora da tela do celular. */}
                      <div className="form-actions climate-acoes">
                        {r.status === "OPEN" && (
                          <Button
                            type="button"
                            disabled={mudando === r.id}
                            onClick={() => void abrirParaResponder(r.id)}
                          >
                            Responder
                          </Button>
                        )}
                        {canManage && r.status === "DRAFT" && (
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={
                              mudando === r.id || (r._count?.questions ?? 0) === 0
                            }
                            onClick={() => void mudarSituacao(r.id, "abrir")}
                          >
                            Abrir para respostas
                          </Button>
                        )}
                        {canManage && r.status === "OPEN" && (
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={mudando === r.id}
                            onClick={() => void mudarSituacao(r.id, "encerrar")}
                          >
                            Encerrar
                          </Button>
                        )}
                      </div>
                      {/* Abrir uma pesquisa sem pergunta dá uma pesquisa que
                          ninguém consegue responder. */}
                      {canManage &&
                        r.status === "DRAFT" &&
                        (r._count?.questions ?? 0) === 0 && (
                          <div className="form-hint">
                            Sem pergunta nenhuma: não dá para abrir.
                          </div>
                        )}
                    </td>
                    <td className="climate-col-extra">
                      {r._count?.questions ?? 0} pergunta(s)
                      <div className="muted">
                        {r._count?.responses ?? 0} resposta(s)
                      </div>
                    </td>
                    <td className="climate-col-extra">
                      {formatDay(r.createdAt)}
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
