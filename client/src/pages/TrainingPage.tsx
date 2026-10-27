import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  completeTraining,
  fetchTraining,
  startTraining,
  TRAINING_KIND_LABEL,
  type CompleteResult,
  type TrainingFull,
} from "@/api/trainings";
import { confirmSummonAttendance } from "@/api/modules";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/auth/AuthContext";
import {
  formatDay,
  formatDayTime,
  jaChegou,
  SUMMON_ATTENDANCE_LABEL,
  summonAttendanceTone,
} from "@/lib/labels";
import { isReadOnlyPermission } from "@/lib/module-access";
import "@/components/form.css";
import "./training-page.css";

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Fazer o treinamento: ler o conteúdo, responder e receber o certificado.
 *
 * Antes o portal listava o curso e parava aí — matricular-se existia só na
 * API, e não havia tela nenhuma para o conteúdo nem para a prova. [S4-C]
 */
export function TrainingPage() {
  const { user } = useAuth();
  const { id = "" } = useParams();
  const [training, setTraining] = useState<TrainingFull | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passo, setPasso] = useState(0);
  const [respostas, setRespostas] = useState<Record<string, number>>({});
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<CompleteResult | null>(null);
  const [erroProva, setErroProva] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [erroConfirmar, setErroConfirmar] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await fetchTraining(id);
    setTraining(data.training);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    load().catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Falha ao carregar");
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function comecar() {
    setErroProva(null);
    setResultado(null);
    setRespostas({});
    setPasso(1);
    try {
      await startTraining(id);
      await load();
    } catch (err) {
      setErroProva(err instanceof Error ? err.message : "Falha ao iniciar");
    }
  }

  async function entregar() {
    if (!training) return;
    const faltando = training.questions.filter((q) => respostas[q.id] === undefined);
    if (faltando.length > 0) {
      setErroProva(
        faltando.length === 1
          ? "Falta responder 1 pergunta."
          : `Faltam responder ${faltando.length} perguntas.`,
      );
      return;
    }
    setEnviando(true);
    setErroProva(null);
    try {
      const res = await completeTraining(
        id,
        training.questions.map((q) => ({ question_id: q.id, index: respostas[q.id]! })),
      );
      setResultado(res);
      await load();
    } catch (err) {
      setErroProva(err instanceof Error ? err.message : "Falha ao enviar");
    } finally {
      setEnviando(false);
    }
  }

  /* Quem foi convocado confirma aqui mesmo, sem ir a Convocações. [B3-3-C] */
  async function confirmarPresenca(summonId: string) {
    setConfirmando(true);
    setErroConfirmar(null);
    try {
      await confirmSummonAttendance(summonId);
      await load();
    } catch (err) {
      setErroConfirmar(err instanceof Error ? err.message : "Falha ao confirmar");
    } finally {
      setConfirmando(false);
    }
  }

  if (error) {
    return (
      <div>
        <p className="page-error" role="alert">
          {error}
        </p>
        <Link to="/treinamentos">Voltar aos treinamentos</Link>
      </div>
    );
  }
  if (!training) return <LoadingState label="Carregando o treinamento…" />;

  const matricula = training.my_enrollment;
  const soConsulta = isReadOnlyPermission(user?.permission);
  const concluido = matricula?.status === "COMPLETED";
  const reprovado = matricula?.status === "FAILED";
  const presencial = training.kind === "CLASSROOM";
  const turma = training.my_session;
  const slides = training.slides;
  const total = slides.length;
  const naProva = passo > total;

  return (
    <div className="tr-page">
      <Link to="/treinamentos" className="tr-back">
        ← Treinamentos
      </Link>

      <PageHeader
        title={training.title}
        description={training.summary ?? undefined}
      />

      <section className="tr-facts">
        <span>{TRAINING_KIND_LABEL[training.kind] ?? training.kind}</span>
        <span>{training.durationMinutes} min</span>
        <span>{training.category}</span>
        {training.questions.length > 0 && (
          <span>
            {training.questions.length === 1
              ? "1 pergunta"
              : `${training.questions.length} perguntas`}{" "}
            · nota mínima {training.passingScore}%
          </span>
        )}
        {training.validityMonths && <span>vale {training.validityMonths} meses</span>}
      </section>

      {concluido && (
        <section className="tr-done">
          <div>
            <strong>Treinamento concluído</strong>
            <div className="muted">
              {matricula.completedAt && `em ${formatDateTime(matricula.completedAt)}`}
              {matricula.score != null && ` · nota ${matricula.score}%`}
            </div>
            {matricula.certificateCode && (
              <div>
                Certificado <code className="tr-code">{matricula.certificateCode}</code>
                {matricula.expiresAt && (
                  <span className="muted"> · vale até {formatDay(matricula.expiresAt)}</span>
                )}
                {/* Era só o código: não havia o que abrir, imprimir ou
                    entregar. [B2-3-C] */}
                <div>
                  <Link to={`/certificados/${matricula.id}`}>
                    Abrir certificado
                  </Link>
                </div>
              </div>
            )}
            {/* Vale até vencer, mas abaixo da nota de hoje: a pessoa pode
                refazer, e antes ouvia "Treinamento já concluído". [CB-31] */}
            {matricula.below_minimum && (
              <p className="tr-retry">
                Este certificado foi emitido antes da nota mínima atual. Vale
                até o vencimento; para renovar, refaça o treinamento.
              </p>
            )}
          </div>
        </section>
      )}

      {/*
        O convocado abria o treinamento e não via a turma para a qual foi
        chamado: quando, onde e com quem só estavam no aviso. [B3-3-C]
      */}
      {presencial && turma && (
        <section className="tr-classroom tr-turma">
          <strong>
            {jaChegou(turma.held_at)
              ? "Sua turma"
              : "Você está convocado para esta turma"}
          </strong>
          <dl className="tr-turma-fatos">
            <dt>Quando</dt>
            <dd>{formatDayTime(turma.held_at)}</dd>
            <dt>Onde</dt>
            <dd>{turma.location ?? "Local ainda não informado"}</dd>
            <dt>Com</dt>
            <dd>{turma.instructor_name}</dd>
            <dt>Duração</dt>
            <dd>{turma.duration_minutes} min</dd>
          </dl>
          <div className="tr-turma-presenca">
            <Chip tone={summonAttendanceTone(turma.attendance_status)}>
              {SUMMON_ATTENDANCE_LABEL[turma.attendance_status] ??
                turma.attendance_status}
            </Chip>
            {turma.attendance_status === "INVITED" && !jaChegou(turma.held_at) && (
              <Button
                type="button"
                disabled={confirmando}
                onClick={() => void confirmarPresenca(turma.summon_id)}
              >
                {confirmando ? "Confirmando…" : "Confirmar presença"}
              </Button>
            )}
          </div>
          {erroConfirmar && (
            <p className="form-error" role="alert">
              {erroConfirmar}
            </p>
          )}
        </section>
      )}

      {presencial && !concluido && (
        <section className="tr-classroom">
          <strong>Este treinamento é presencial.</strong>
          <p className="muted">
            A presença é registrada por quem dá a aula. Quando a turma for
            lançada, o certificado aparece aqui.
          </p>
        </section>
      )}

      {/*
        Quem só consulta lê o conteúdo do treinamento; começar seria
        recusado pelo servidor, e o botão só prometia erro. [B2-4-F]
      */}
      {soConsulta && !presencial && (
        <p className="muted">
          Acesso de consulta: o conteúdo abre para leitura, sem inscrição nem
          prova.
        </p>
      )}

      {!soConsulta && !presencial && !concluido && passo === 0 && (
        <section className="form-section">
          {reprovado && (
            <p className="tr-retry">
              Você fez a prova e ficou com {matricula.score}%. A nota mínima é{" "}
              {training.passingScore}%. Reveja o conteúdo e tente de novo.
            </p>
          )}
          <p className="muted">
            {total > 0
              ? `São ${total === 1 ? "1 tela" : `${total} telas`} de conteúdo${
                  training.questions.length > 0 ? " e depois a prova." : "."
                }`
              : "Leia o conteúdo e responda a prova."}
          </p>
          <div className="form-actions">
            <Button type="button" onClick={() => void comecar()}>
              {reprovado ? "Fazer de novo" : matricula ? "Continuar" : "Começar o treinamento"}
            </Button>
          </div>
        </section>
      )}

      {!presencial && !concluido && passo > 0 && !naProva && (
        <section className="form-section tr-slide">
          <p className="tr-progress">
            {passo} de {total}
          </p>
          {slides[passo - 1]?.title && <h2>{slides[passo - 1]!.title}</h2>}
          <p className="tr-body">{slides[passo - 1]?.body}</p>
          <div className="form-actions">
            {passo > 1 && (
              <Button type="button" variant="ghost" onClick={() => setPasso(passo - 1)}>
                Voltar
              </Button>
            )}
            <Button type="button" onClick={() => setPasso(passo + 1)}>
              {passo === total
                ? training.questions.length > 0
                  ? "Ir para a prova"
                  : "Concluir"
                : "Avançar"}
            </Button>
          </div>
        </section>
      )}

      {!presencial && !concluido && naProva && (
        <section className="form-section">
          <h2>Prova</h2>
          {training.questions.length === 0 ? (
            <>
              <p className="muted">Este treinamento não tem prova.</p>
              <div className="form-actions">
                <Button type="button" disabled={enviando} onClick={() => void entregar()}>
                  {enviando ? "Concluindo…" : "Concluir treinamento"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <ol className="tr-questions">
                {training.questions.map((q) => (
                  <li key={q.id}>
                    <p className="tr-prompt">{q.prompt}</p>
                    <div className="tr-options">
                      {q.options.map((opcao, i) => (
                        <label key={i} className="tr-option">
                          <input
                            type="radio"
                            name={q.id}
                            checked={respostas[q.id] === i}
                            onChange={() => setRespostas({ ...respostas, [q.id]: i })}
                          />
                          <span>{opcao}</span>
                        </label>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
              {erroProva && (
                <p className="form-error" role="alert">
                  {erroProva}
                </p>
              )}
              <div className="form-actions">
                <Button type="button" variant="ghost" onClick={() => setPasso(total)}>
                  Rever o conteúdo
                </Button>
                <Button type="button" disabled={enviando} onClick={() => void entregar()}>
                  {enviando ? "Enviando…" : "Entregar a prova"}
                </Button>
              </div>
            </>
          )}
        </section>
      )}

      {resultado && !resultado.passed && (
        <section className="tr-failed" role="status">
          <Chip tone="warning">Não passou</Chip>
          <p>{resultado.message}</p>
          <Button type="button" onClick={() => void comecar()}>
            Rever o conteúdo e tentar de novo
          </Button>
        </section>
      )}
    </div>
  );
}
