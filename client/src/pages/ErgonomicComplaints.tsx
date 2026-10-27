import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  closeErgonomicComplaint,
  createErgonomicComplaint,
  evaluateErgonomicComplaint,
  fetchErgonomicComplaints,
  type ErgonomicComplaint,
} from "@/api/ergonomic-complaints";
import { fetchEstablishments, type Establishment } from "@/api/operation";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { formatDay } from "@/lib/labels";
import "@/components/form.css";

const SITUACAO: Record<ErgonomicComplaint["status"], string> = {
  OPEN: "Esperando o SST",
  IN_EVALUATION: "Virou avaliação",
  CLOSED: "Respondida",
};

function tone(status: ErgonomicComplaint["status"]): "warning" | "success" | "neutral" {
  if (status === "OPEN") return "warning";
  if (status === "IN_EVALUATION") return "success";
  return "neutral";
}

/**
 * Onde quem faz o trabalho diz que dói.
 *
 * A Avaliação ergonômica era, para quem trabalha, uma lista sem nenhum
 * botão. A queixa é dela; transformá-la em avaliação é do SST. [P1]
 */
export function ErgonomicComplaints({ onEvaluated }: { onEvaluated?: () => void }) {
  const [rows, setRows] = useState<ErgonomicComplaint[]>([]);
  const [manages, setManages] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [onde, setOnde] = useState("");
  const [oQue, setOQue] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  /** A queixa que o SST está respondendo, e como. */
  const [respondendo, setRespondendo] = useState<string | null>(null);
  const [acao, setAcao] = useState<"avaliar" | "encerrar">("avaliar");
  const [unidades, setUnidades] = useState<Establishment[]>([]);
  const [unidade, setUnidade] = useState("");
  const [escopo, setEscopo] = useState("");
  const [recado, setRecado] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erroResposta, setErroResposta] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    const data = await fetchErgonomicComplaints();
    setRows(data.complaints);
    setManages(data.manages);
    return data.manages;
  }, []);

  useEffect(() => {
    recarregar()
      .then((cuida) => {
        if (!cuida) return;
        return fetchEstablishments()
          .then((d) => setUnidades(d.establishments.filter((u) => !u.archivedAt)))
          .catch(() => setUnidades([]));
      })
      .catch((err) => setErro(err instanceof Error ? err.message : "Falha ao carregar"))
      .finally(() => setCarregando(false));
  }, [recarregar]);

  async function registrar(e: FormEvent) {
    e.preventDefault();
    if (!oQue.trim()) return;
    setEnviando(true);
    setErro(null);
    try {
      await createErgonomicComplaint({
        description: oQue.trim(),
        body_part: onde.trim() || undefined,
      });
      setOnde("");
      setOQue("");
      setAviso("Queixa registrada. O SST foi avisado.");
      await recarregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao registrar");
    } finally {
      setEnviando(false);
    }
  }

  function abrirResposta(id: string, como: "avaliar" | "encerrar") {
    setRespondendo(id);
    setAcao(como);
    setEscopo("");
    setRecado("");
    setErroResposta(null);
    setUnidade(unidades[0]?.id ?? "");
  }

  async function responder(e: FormEvent) {
    e.preventDefault();
    if (!respondendo) return;
    setOcupado(true);
    setErroResposta(null);
    try {
      if (acao === "avaliar") {
        await evaluateErgonomicComplaint(respondendo, {
          establishment_id: unidade,
          scope_description: escopo.trim(),
          note: recado.trim() || undefined,
        });
        onEvaluated?.();
      } else {
        await closeErgonomicComplaint(respondendo, recado.trim());
      }
      setRespondendo(null);
      await recarregar();
    } catch (err) {
      setErroResposta(err instanceof Error ? err.message : "Falha ao responder");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="form-section">
      <h2>Desconforto no trabalho</h2>
      <p className="muted" style={{ maxWidth: "70ch" }}>
        {manages
          ? "O que as pessoas relataram sobre dor e desconforto. Cada queixa vira uma avaliação ergonômica ou recebe uma resposta por escrito."
          : "Sentiu dor ou desconforto fazendo o seu trabalho? Registre aqui. Quem cuida da segurança é avisado e responde."}
      </p>

      <form className="form-grid" onSubmit={registrar}>
        <div className="form-grid cols-2">
          <label className="form-field">
            Onde incomoda (opcional)
            <input
              value={onde}
              onChange={(e) => setOnde(e.target.value)}
              placeholder="Ombro direito, lombar, punho…"
              maxLength={120}
            />
          </label>
        </div>
        <label className="form-field">
          O que incomoda, e fazendo o quê
          <textarea
            value={oQue}
            onChange={(e) => setOQue(e.target.value)}
            placeholder="Ex.: dói o ombro ao fixar a peça na placa do torno, no fim do turno."
            required
          />
        </label>
        <div className="form-actions">
          <Button type="submit" disabled={enviando || !oQue.trim()}>
            {enviando ? "Registrando…" : "Registrar queixa"}
          </Button>
        </div>
        {aviso && <p className="muted">{aviso}</p>}
        {erro && (
          <p className="form-error" role="alert">
            {erro}
          </p>
        )}
      </form>

      {carregando && <p className="muted">Carregando…</p>}

      {!carregando && rows.length === 0 && (
        <p className="muted">
          {manages ? "Nenhuma queixa registrada." : "Você ainda não registrou nenhuma queixa."}
        </p>
      )}

      {rows.length > 0 && (
        <ul
          style={{ listStyle: "none", padding: 0, margin: "1rem 0", display: "grid", gap: "0.75rem" }}
        >
          {rows.map((q) => (
            <li
              key={q.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: "10px",
                padding: "0.75rem 1rem",
              }}
            >
              <p style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", margin: 0 }}>
                <Chip tone={tone(q.status)}>{SITUACAO[q.status]}</Chip>
                {q.bodyPart && <Chip>{q.bodyPart}</Chip>}
                {manages && <Chip>{q.user.name}</Chip>}
                {q.jobRoleName && <Chip>{q.jobRoleName}</Chip>}
                {q.establishment && <Chip>{q.establishment.name}</Chip>}
              </p>
              <p style={{ whiteSpace: "pre-wrap", maxWidth: "70ch" }}>{q.description}</p>
              <p className="muted" style={{ margin: 0 }}>
                Registrada em {formatDay(q.createdAt)}
              </p>

              {q.handlingNote && (
                <p style={{ maxWidth: "70ch" }}>
                  <strong>Resposta:</strong> {q.handlingNote}
                  {q.handledBy && (
                    <span className="muted">
                      {" "}
                      — {q.handledBy.name}
                      {q.handledAt ? `, em ${formatDay(q.handledAt)}` : ""}
                    </span>
                  )}
                </p>
              )}

              {manages && q.status === "OPEN" && respondendo !== q.id && (
                <div className="form-actions">
                  <Button type="button" onClick={() => abrirResposta(q.id, "avaliar")}>
                    Transformar em avaliação
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => abrirResposta(q.id, "encerrar")}
                  >
                    Responder sem avaliar
                  </Button>
                </div>
              )}

              {manages && respondendo === q.id && (
                <form className="form-grid" onSubmit={responder}>
                  {acao === "avaliar" ? (
                    <>
                      <label className="form-field">
                        Unidade
                        <select value={unidade} onChange={(e) => setUnidade(e.target.value)} required>
                          <option value="">Escolha a unidade</option>
                          {unidades.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="form-field">
                        O que será avaliado
                        <input
                          value={escopo}
                          onChange={(e) => setEscopo(e.target.value)}
                          placeholder="Ex.: fixação de peças pesadas no torno — usinagem"
                          required
                        />
                      </label>
                      <label className="form-field">
                        Recado para quem registrou (opcional)
                        <textarea value={recado} onChange={(e) => setRecado(e.target.value)} />
                      </label>
                    </>
                  ) : (
                    <label className="form-field">
                      Por que não vai virar avaliação
                      <textarea
                        value={recado}
                        onChange={(e) => setRecado(e.target.value)}
                        placeholder="É o texto que a pessoa vai ler."
                        required
                      />
                    </label>
                  )}
                  <div className="form-actions">
                    <Button
                      type="submit"
                      disabled={
                        ocupado ||
                        (acao === "avaliar"
                          ? !unidade || !escopo.trim()
                          : !recado.trim())
                      }
                    >
                      {ocupado
                        ? "Enviando…"
                        : acao === "avaliar"
                          ? "Abrir avaliação"
                          : "Enviar resposta"}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setRespondendo(null)}>
                      Cancelar
                    </Button>
                  </div>
                  {erroResposta && (
                    <p className="form-error" role="alert">
                      {erroResposta}
                    </p>
                  )}
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
