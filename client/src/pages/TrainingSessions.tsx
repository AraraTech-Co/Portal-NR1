import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchTrainingSessions,
  recordTrainingSession,
  type TrainingSession,
} from "@/api/trainings";
import { fetchOrgMembers, type OrgMember } from "@/api/org-members";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { formatDay } from "@/lib/labels";
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
  const [data, setData] = useState(hojeIso());
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

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (presentes.size === 0) {
      setErro("Marque quem esteve na turma.");
      return;
    }
    setSalvando(true);
    try {
      await recordTrainingSession(trainingId, {
        held_at: data,
        instructor_name: instrutor.trim(),
        instructor_registration: registro.trim() || undefined,
        location: local.trim() || undefined,
        duration_minutes: Number(minutos) || defaultMinutes,
        notes: observacao.trim() || undefined,
        attendees: [...presentes].map((id) => ({ user_id: id, present: true })),
      });
      setAberto(false);
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
        <Button type="button" variant="secondary" onClick={() => setAberto(true)}>
          Registrar turma presencial
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
            max={hojeIso()}
            onChange={(e) => setData(e.target.value)}
            required
          />
        </label>
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
          {salvando ? "Registrando…" : "Registrar a turma"}
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
              <div className="tr-session-head">
                <strong>{formatDay(s.held_at)}</strong>
                <Chip tone="success">
                  {s.present === 1 ? "1 presente" : `${s.present} presentes`}
                </Chip>
                {s.absent > 0 && <Chip tone="warning">{s.absent} ausente(s)</Chip>}
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
              <div className="muted">Registrada por {s.recorded_by.name}</div>
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
