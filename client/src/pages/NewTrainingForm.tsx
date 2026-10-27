import { FormEvent, useState } from "react";
import { createTraining } from "@/api/trainings";
import { Button } from "@/components/Button";
import "@/components/form.css";

type Pergunta = {
  prompt: string;
  options: string[];
  correct_index: number;
};

/**
 * Cadastrar treinamento pela tela.
 *
 * Título, tipo, conteúdo, prova e nota mínima só entravam pela API: o
 * treinamento presencial da bateria de testes precisou ser criado fora da
 * tela, e a nota mínima não se mudava por lugar nenhum. [CB-30]
 */
export function NewTrainingForm({ onCreated }: { onCreated: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("ONLINE");
  const [summary, setSummary] = useState("");
  const [duration, setDuration] = useState("60");
  const [passingScore, setPassingScore] = useState("70");
  const [validity, setValidity] = useState("");
  /* O que o certificado pede (NR-1 1.7.1.1). [B3-3-G] */
  const [instrutor, setInstrutor] = useState("");
  const [qualificacaoInstrutor, setQualificacaoInstrutor] = useState("");
  const [responsavelTecnico, setResponsavelTecnico] = useState("");
  const [qualificacaoResponsavel, setQualificacaoResponsavel] = useState("");
  const [perguntas, setPerguntas] = useState<Pergunta[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const online = kind === "ONLINE";

  function novaPergunta() {
    setPerguntas((p) => [
      ...p,
      { prompt: "", options: ["", ""], correct_index: 0 },
    ]);
  }

  function mudar(i: number, campo: Partial<Pergunta>) {
    setPerguntas((p) => p.map((q, idx) => (idx === i ? { ...q, ...campo } : q)));
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!title.trim()) {
      setErro("Dê um título ao treinamento.");
      return;
    }
    const nota = Number(passingScore);
    if (!Number.isInteger(nota) || nota < 0 || nota > 100) {
      setErro("A nota mínima vai de 0 a 100.");
      return;
    }
    const validas = perguntas
      .map((q) => ({
        prompt: q.prompt.trim(),
        options: q.options.map((o) => o.trim()).filter(Boolean),
        correct_index: q.correct_index,
      }))
      .filter((q) => q.prompt && q.options.length >= 2);
    if (online && perguntas.length > 0 && validas.length !== perguntas.length) {
      setErro("Cada pergunta precisa do enunciado e de pelo menos duas opções.");
      return;
    }

    setSalvando(true);
    try {
      await createTraining({
        title: title.trim(),
        kind,
        summary: summary.trim() || undefined,
        duration_minutes: Number(duration) || 60,
        passing_score: nota,
        validity_months: validity ? Number(validity) : undefined,
        instructor_name: instrutor.trim() || undefined,
        instructor_qualification: qualificacaoInstrutor.trim() || undefined,
        technical_responsible_name: responsavelTecnico.trim() || undefined,
        technical_responsible_qualification: qualificacaoResponsavel.trim() || undefined,
        questions: online && validas.length > 0 ? validas : undefined,
      });
      setTitle("");
      setSummary("");
      setInstrutor("");
      setQualificacaoInstrutor("");
      setResponsavelTecnico("");
      setQualificacaoResponsavel("");
      setPerguntas([]);
      setAberto(false);
      onCreated();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao cadastrar");
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <Button type="button" onClick={() => setAberto(true)}>
        Cadastrar treinamento
      </Button>
    );
  }

  return (
    <form className="form-grid form-section" onSubmit={salvar}>
      <h2>Novo treinamento</h2>
      <div className="form-grid cols-2">
        <label className="form-field">
          Título
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label className="form-field">
          Como é dado
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="ONLINE">A distância, pelo portal</option>
            <option value="CLASSROOM">Presencial, com turma</option>
          </select>
          {!online && (
            <span className="form-hint">
              A conclusão vem da lista de presença da turma.
            </span>
          )}
        </label>
      </div>
      <label className="form-field">
        Conteúdo programático
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="O que a pessoa vai aprender. Vai no certificado."
        />
      </label>
      <div className="form-grid cols-2">
        <label className="form-field">
          Carga horária (minutos)
          <input
            type="number"
            min={1}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </label>
        <label className="form-field">
          Nota mínima (%)
          <input
            type="number"
            min={0}
            max={100}
            value={passingScore}
            onChange={(e) => setPassingScore(e.target.value)}
          />
          {/* A nota mínima não se alterava por tela nenhuma. [CB-30] */}
          <span className="form-hint">
            Abaixo dela não sai certificado: certificado é prova de capacitação.
          </span>
        </label>
        <label className="form-field">
          Validade (meses)
          <input
            type="number"
            min={1}
            value={validity}
            onChange={(e) => setValidity(e.target.value)}
            placeholder="Em branco: sem reciclagem obrigatória"
          />
        </label>
      </div>

      <fieldset className="form-grid">
        <legend>Para o certificado</legend>
        <p className="form-hint">
          A NR-1 (1.7.1.1) pede no certificado o nome e a qualificação de quem
          ministra e a assinatura do responsável técnico.
          {online
            ? " No curso a distância, quem ministra sai daqui."
            : " No presencial, quem deu a aula é o da turma; o nome daqui vem sugerido."}
        </p>
        <div className="form-grid cols-2">
          <label className="form-field">
            Quem ministra
            <input value={instrutor} onChange={(e) => setInstrutor(e.target.value)} />
          </label>
          <label className="form-field">
            Qualificação de quem ministra
            <input
              value={qualificacaoInstrutor}
              onChange={(e) => setQualificacaoInstrutor(e.target.value)}
              placeholder="Ex.: Técnico em Segurança do Trabalho"
            />
          </label>
          <label className="form-field">
            Responsável técnico
            <input
              value={responsavelTecnico}
              onChange={(e) => setResponsavelTecnico(e.target.value)}
            />
          </label>
          <label className="form-field">
            Qualificação do responsável técnico
            <input
              value={qualificacaoResponsavel}
              onChange={(e) => setQualificacaoResponsavel(e.target.value)}
              placeholder="Ex.: Engenheiro de Segurança do Trabalho"
            />
          </label>
        </div>
      </fieldset>

      {online && (
        <section>
          <h3>Prova</h3>
          {perguntas.length === 0 && (
            <p className="muted">
              Sem perguntas, o treinamento conclui só com a leitura.
            </p>
          )}
          {perguntas.map((q, i) => (
            <div key={i} className="form-grid">
              <label className="form-field">
                Pergunta {i + 1}
                <input
                  value={q.prompt}
                  onChange={(e) => mudar(i, { prompt: e.target.value })}
                />
              </label>
              {q.options.map((o, j) => (
                <label className="form-field" key={j}>
                  <span>
                    <input
                      type="radio"
                      name={`correta-${i}`}
                      checked={q.correct_index === j}
                      onChange={() => mudar(i, { correct_index: j })}
                    />{" "}
                    Opção {j + 1} {q.correct_index === j ? "(correta)" : ""}
                  </span>
                  <input
                    value={o}
                    onChange={(e) =>
                      mudar(i, {
                        options: q.options.map((x, k) =>
                          k === j ? e.target.value : x,
                        ),
                      })
                    }
                  />
                </label>
              ))}
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  mudar(i, { options: [...q.options, ""] })
                }
              >
                Mais uma opção
              </Button>
            </div>
          ))}
          <Button type="button" variant="ghost" onClick={novaPergunta}>
            Acrescentar pergunta
          </Button>
        </section>
      )}

      {erro && (
        <p className="form-error" role="alert">
          {erro}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" disabled={salvando}>
          {salvando ? "Cadastrando…" : "Cadastrar treinamento"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
