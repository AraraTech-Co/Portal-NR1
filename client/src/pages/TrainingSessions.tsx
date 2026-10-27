import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchTrainingSessions,
  recordSessionAttendance,
  recordTrainingSession,
  type TrainingSession,
} from "@/api/trainings";
import { fetchOrgMembers, type OrgMember } from "@/api/org-members";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { formatDayTime, jaChegou } from "@/lib/labels";
import "@/components/form.css";
import "./training-page.css";

function hojeIso(): string {
  return new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
}

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Registrar a turma presencial que aconteceu: quem deu, quando, quanto tempo
 * e quem esteve. Sem isto o treinamento presencial não deixava rastro. [S4-D]
 */
/**
 * A lista de presença de uma turma que já foi marcada.
 *
 * A turma agendada existe antes da aula; depois que ela acontece, é aqui que
 * se diz quem esteve — e é isso que gera o certificado. [CB-34]
 */
function AttendanceForm({
  trainingId,
  sessionId,
  onSaved,
}: {
  trainingId: string;
  sessionId: string;
  onSaved: () => Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [membros, setMembros] = useState<OrgMember[]>([]);
  const [busca, setBusca] = useState("");
  const [presentes, setPresentes] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    fetchOrgMembers()
      .then(setMembros)
      .catch(() => setMembros([]));
  }, [aberto]);

  const filtrados = useMemo(() => {
    const termo = semAcento(busca.trim());
    if (!termo) return membros;
    return membros.filter((m) =>
      [m.name, m.registration ?? "", m.jobRoleName ?? ""].some((c) =>
        semAcento(c).includes(termo),
      ),
    );
  }, [membros, busca]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (presentes.size === 0) {
      setErro("Marque quem esteve na turma.");
      return;
    }
    setSalvando(true);
    try {
      await recordSessionAttendance(
        trainingId,
        sessionId,
        [...presentes].map((id) => ({ user_id: id, present: true })),
      );
      setAberto(false);
      setPresentes(new Set());
      await onSaved();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao registrar");
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={() => setAberto(true)}>
          Lançar a presença
        </Button>
      </div>
    );
  }

  return (
    <form className="form-grid tr-session-form" onSubmit={salvar}>
      <fieldset className="tr-attendance">
        <legend>
          Quem esteve{" "}
          <span className="muted">
            {presentes.size === 0
              ? "ninguém marcado"
              : presentes.size === 1
                ? "1 pessoa"
                : `${presentes.size} pessoas`}
          </span>
        </legend>
        <input
          className="tr-attendance-search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, matrícula ou função"
        />
        <div className="tr-attendance-list">
          {filtrados.map((m) => (
            <label key={m.id} className="tr-attendance-item">
              <input
                type="checkbox"
                checked={presentes.has(m.id)}
                onChange={() => {
                  const proximo = new Set(presentes);
                  if (proximo.has(m.id)) proximo.delete(m.id);
                  else proximo.add(m.id);
                  setPresentes(proximo);
                }}
              />
              <span>
                {m.name}
                {m.jobRoleName && <span className="muted"> · {m.jobRoleName}</span>}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {erro && (
        <p className="form-error" role="alert">
          {erro}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" disabled={salvando}>
          {salvando ? "Lançando…" : "Lançar a presença"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function RecordForm({
  trainingId,
  defaultMinutes,
  onSaved,
}: {
  trainingId: string;
  defaultMinutes: number;
  onSaved: () => Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  /*
    A turma só podia ser registrada depois de acontecer: não havia como
    marcar a aula nem chamar ninguém antes. [CB-34]
  */
  const [modo, setModo] = useState<"registrar" | "agendar">("registrar");
  const [data, setData] = useState(hojeIso());
  /* A turma tinha só o dia: o convocado não sabia a hora da aula. [B3-3-C] */
  const [hora, setHora] = useState("");
  const [instrutor, setInstrutor] = useState("");
  const [registro, setRegistro] = useState("");
  const [local, setLocal] = useState("");
  const [minutos, setMinutos] = useState(String(defaultMinutes));
  const [observacao, setObservacao] = useState("");
  const [membros, setMembros] = useState<OrgMember[]>([]);
  const [busca, setBusca] = useState("");
  const [presentes, setPresentes] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    fetchOrgMembers()
      .then(setMembros)
      .catch(() => setMembros([]));
  }, [aberto]);

  const filtrados = useMemo(() => {
    const termo = semAcento(busca.trim());
    if (!termo) return membros;
    return membros.filter((m) =>
      [m.name, m.registration ?? "", m.jobRoleName ?? ""].some((c) =>
        semAcento(c).includes(termo),
      ),
    );
  }, [membros, busca]);

  function alternar(id: string) {
    const proximo = new Set(presentes);
    if (proximo.has(id)) proximo.delete(id);
    else proximo.add(id);
    setPresentes(proximo);
  }

  const agendando = modo === "agendar";

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!agendando && presentes.size === 0) {
      setErro("Marque quem esteve na turma.");
      return;
    }
    if (agendando && data <= hojeIso()) {
      setErro("Para agendar, escolha uma data no futuro.");
      return;
    }
    setSalvando(true);
    try {
      await recordTrainingSession(trainingId, {
        /* Com hora, é o instante no relógio de quem marca; sem, só o dia. */
        held_at:
          agendando && hora ? new Date(`${data}T${hora}`).toISOString() : data,
        instructor_name: instrutor.trim(),
        instructor_registration: registro.trim() || undefined,
        location: local.trim() || undefined,
        duration_minutes: Number(minutos) || defaultMinutes,
        notes: observacao.trim() || undefined,
        ...(agendando
          ? { invite_user_ids: [...presentes] }
          : {
              attendees: [...presentes].map((id) => ({
                user_id: id,
                present: true,
              })),
            }),
      });
      setAberto(false);
      setHora("");
      setInstrutor("");
      setRegistro("");
      setLocal("");
      setObservacao("");
      setPresentes(new Set());
      await onSaved();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao registrar");
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <div className="form-actions">
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setModo("registrar");
            setData(hojeIso());
            setAberto(true);
          }}
        >
          Registrar turma que já aconteceu
        </Button>
        {/* Marcar a aula antes, e chamar quem precisa ir. [CB-34] */}
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setModo("agendar");
            setData("");
            setAberto(true);
          }}
        >
          Marcar turma e convocar
        </Button>
      </div>
    );
  }

  return (
    <form className="form-grid tr-session-form" onSubmit={salvar}>
      <div className="form-grid cols-2">
        <label className="form-field">
          Data da aula
          <input
            type="date"
            value={data}
            max={agendando ? undefined : hojeIso()}
            min={agendando ? hojeIso() : undefined}
            onChange={(e) => setData(e.target.value)}
            required
          />
          <span className="form-hint">
            {agendando
              ? "A lista de presença entra depois da aula."
              : "Só data que já passou: a presença é do que aconteceu."}
          </span>
        </label>
        {agendando && (
          <label className="form-field">
            Horário (opcional)
            <input
              type="time"
              value={hora}
              onChange={(e) => setHora(e.target.value)}
            />
            <span className="form-hint">Aparece para quem for convocado.</span>
          </label>
        )}
        <label className="form-field">
          Carga horária (minutos)
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={minutos}
            onChange={(e) => setMinutos(e.target.value)}
            required
          />
        </label>
      </div>
      <div className="form-grid cols-2">
        <label className="form-field">
          Quem deu o treinamento
          <input
            value={instrutor}
            onChange={(e) => setInstrutor(e.target.value)}
            required
            maxLength={120}
          />
        </label>
        <label className="form-field">
          Registro profissional (opcional)
          <input value={registro} onChange={(e) => setRegistro(e.target.value)} />
        </label>
      </div>
      <label className="form-field">
        Local (opcional)
        <input value={local} onChange={(e) => setLocal(e.target.value)} />
      </label>

      <fieldset className="tr-attendance">
        <legend>
          {agendando ? "Quem convocar" : "Quem esteve"}{" "}
          <span className="muted">
            {presentes.size === 0
              ? "ninguém marcado"
              : presentes.size === 1
                ? "1 pessoa"
                : `${presentes.size} pessoas`}
          </span>
        </legend>
        <input
          className="tr-attendance-search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, matrícula ou função"
        />
        <div className="tr-attendance-list">
          {filtrados.map((m) => (
            <label key={m.id} className="tr-option">
              <input
                type="checkbox"
                checked={presentes.has(m.id)}
                onChange={() => alternar(m.id)}
              />
              <span>
                {m.name}
                {(m.registration || m.jobRoleName) && (
                  <span className="muted">
                    {" "}
                    · {[m.registration, m.jobRoleName].filter(Boolean).join(" · ")}
                  </span>
                )}
              </span>
            </label>
          ))}
          {filtrados.length === 0 && <p className="muted">Ninguém com esse termo.</p>}
        </div>
      </fieldset>

      <label className="form-field">
        Observações (opcional)
        <textarea
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          rows={2}
        />
      </label>

      {erro && (
        <p className="form-error" role="alert">
          {erro}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" disabled={salvando}>
          {salvando
            ? agendando
              ? "Marcando…"
              : "Registrando…"
            : agendando
              ? "Marcar e convocar"
              : "Registrar a turma"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/** Turmas já dadas, com instrutor e lista de presença. [S4-D] */
export function TrainingSessions({
  trainingId,
  kind,
  defaultMinutes,
  canRecord,
  onRecorded,
}: {
  trainingId: string;
  kind: string;
  defaultMinutes: number;
  canRecord: boolean;
  onRecorded?: () => void;
}) {
  const [sessions, setSessions] = useState<TrainingSession[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await fetchTrainingSessions(trainingId);
    setSessions(data.sessions);
  }, [trainingId]);

  useEffect(() => {
    let cancelled = false;
    load().catch((err) => {
      if (!cancelled) setErro(err instanceof Error ? err.message : "Falha ao carregar");
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (kind !== "CLASSROOM") return null;
  if (erro) {
    return (
      <p className="form-error" role="alert">
        {erro}
      </p>
    );
  }

  return (
    <div className="tr-sessions">
      <h3>Turmas presenciais</h3>
      {!sessions && <p className="muted">Carregando…</p>}
      {sessions && sessions.length === 0 && (
        <p className="muted">Nenhuma turma registrada ainda.</p>
      )}
      {sessions && sessions.length > 0 && (
        <ul className="tr-session-list">
          {sessions.map((s) => (
            <li key={s.id}>
              {/* Turma marcada e turma dada não são a mesma coisa: sem
                  lista de presença, ela ainda vai acontecer. [CB-34] */}
              <div className="tr-session-head">
                <strong>{formatDayTime(s.held_at)}</strong>
                {s.present + s.absent === 0 ? (
                  <Chip tone="info">Marcada</Chip>
                ) : (
                  <>
                    <Chip tone="success">
                      {s.present === 1 ? "1 presente" : `${s.present} presentes`}
                    </Chip>
                    {s.absent > 0 && (
                      <Chip tone="warning">{s.absent} ausente(s)</Chip>
                    )}
                  </>
                )}
              </div>
              <div className="muted">
                {s.instructor_name}
                {s.instructor_registration && ` (${s.instructor_registration})`} ·{" "}
                {s.duration_minutes} min
                {s.location && ` · ${s.location}`}
              </div>
              <div className="muted">
                {s.attendances
                  .filter((a) => a.present)
                  .map((a) => a.user.name)
                  .join(", ")}
              </div>
              {s.notes && <div className="tr-session-notes">{s.notes}</div>}
              <div className="muted">
                {s.present + s.absent === 0 ? "Marcada" : "Registrada"} por{" "}
                {s.recorded_by.name}
              </div>
              {/* A aula já passou e ninguém lançou a presença: é aqui que o
                  certificado nasce. [CB-34] */}
              {canRecord &&
                s.present + s.absent === 0 &&
                jaChegou(s.held_at) && (
                  <AttendanceForm
                    trainingId={trainingId}
                    sessionId={s.id}
                    onSaved={async () => {
                      await load();
                      onRecorded?.();
                    }}
                  />
                )}
            </li>
          ))}
        </ul>
      )}
      {canRecord && (
        <RecordForm
          trainingId={trainingId}
          defaultMinutes={defaultMinutes}
          onSaved={async () => {
            await load();
            onRecorded?.();
          }}
        />
      )}
    </div>
  );
}
