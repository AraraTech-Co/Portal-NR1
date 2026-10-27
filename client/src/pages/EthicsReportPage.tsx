import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  createEthicsReport,
  fetchEthicsMeta,
  sendReporterMessage,
  trackEthicsReport,
} from "@/api/ethics";
import { EthicsThread } from "@/components/EthicsThread";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { REPORT_CATEGORY_LABEL, REPORT_STATUS_LABEL } from "@/lib/labels";
import "@/components/form.css";
import "./denuncia.css";

type Mode = "new" | "track";

/**
 * O canal de denúncia.
 *
 * Dentro do portal, quem está logado pode relatar com o nome ou anônimo;
 * fora dele, pelo link público, só existe o anônimo — e é por isso que a
 * página recebe a empresa por fora. [S4-L]
 */
export function EthicsReportPage({
  organizationId,
  publico = false,
  semEmpresa = false,
}: {
  organizationId?: string;
  publico?: boolean;
  /**
   * O endereço não trouxe a empresa: dá para acompanhar um relato, que
   * protocolo e código bastam, mas não dá para enviar um novo — o relato
   * novo precisa saber de qual empresa é. [CB-63]
   */
  semEmpresa?: boolean;
} = {}) {
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>(semEmpresa ? "track" : "new");
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  // Fora do portal não há nome a vincular: a denúncia é sempre anônima.
  const [isAnonymous, setIsAnonymous] = useState(true);
  /*
    "Alguém do comitê de ética está envolvido?" A pergunta não mostra nomes:
    divulgar quem é o comitê é decisão da empresa, e quem relata não precisa
    saber para se proteger. Quando a resposta é sim, o caso vai ao dono ou ao
    master e não passa pelo comitê. [B3-3-H]
  */
  const [envolveComite, setEnvolveComite] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    protocol: string;
    access_code: string;
    is_anonymous: boolean;
  } | null>(null);
  const [copiedKeys, setCopiedKeys] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const [trackProtocol, setTrackProtocol] = useState("");
  const [trackCode, setTrackCode] = useState("");
  const [tracked, setTracked] = useState<{
    protocol: string;
    status: string;
    category: string;
    description: string;
    isAnonymous: boolean;
    resolutionNote: string | null;
    messages: Array<{ id: string; side: string; body: string; createdAt: string }>;
  } | null>(null);
  const [answer, setAnswer] = useState("");
  const [answering, setAnswering] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);

  useEffect(() => {
    fetchEthicsMeta(organizationId)
      .then((meta) => {
        const ids = meta.categories.map((c) => c.id);
        setCategories(ids);
        if (ids[0]) setCategory(ids[0]);
      })
      .catch(() => setCategories(Object.keys(REPORT_CATEGORY_LABEL)));
  }, [organizationId]);

  async function onSubmitNew(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isAnonymous) {
      const ok = window.confirm(
        `Atenção: a denúncia será vinculada ao seu nome (${user?.name ?? "seu usuário"}).\n\n` +
          "O comitê de ética poderá identificar você como autor deste relato.\n\n" +
          "Deseja continuar com a denúncia identificada?",
      );
      if (!ok) return;
    }

    setSaving(true);
    try {
      const data = await createEthicsReport({
        category,
        description,
        is_anonymous: publico ? true : isAnonymous,
        committee_involved: envolveComite,
        ...(organizationId ? { organization_id: organizationId } : {}),
      });
      setResult({
        protocol: data.report.protocol,
        access_code: data.access_code,
        is_anonymous: isAnonymous,
      });
      setCopiedKeys(false);
      setCopyError(null);
      setDescription("");
      setIsAnonymous(true);
      setEnvolveComite(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar");
    } finally {
      setSaving(false);
    }
  }

  async function onTrack(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    setTracked(null);
    try {
      const data = await trackEthicsReport({
        protocol: trackProtocol,
        access_code: trackCode,
      });
      setTracked(data.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não encontrado");
    } finally {
      setSaving(false);
    }
  }

  /** Quem denunciou responde ao comitê pelo protocolo e código. [S5-P] */
  async function onAnswer(e: FormEvent) {
    e.preventDefault();
    if (!answer.trim()) return;
    setAnswering(true);
    setAnswerError(null);
    try {
      await sendReporterMessage({ protocol: trackProtocol, access_code: trackCode, body: answer.trim() });
      setAnswer("");
      const data = await trackEthicsReport({ protocol: trackProtocol, access_code: trackCode });
      setTracked(data.report);
    } catch (err) {
      setAnswerError(err instanceof Error ? err.message : "Falha ao enviar");
    } finally {
      setAnswering(false);
    }
  }

  /** Plano B da cópia: mostrar, em vez de mandar apertar Ctrl+C. [S4-I] */
  const [mostrarChaves, setMostrarChaves] = useState(false);

  async function copyProtocolAndCode() {
    if (!result) return;
    setCopyError(null);
    const text =
      `Protocolo: ${result.protocol}\n` +
      `Código de acesso: ${result.access_code}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKeys(true);
    } catch {
      /*
        Quando o navegador não deixa copiar sozinho (endereço sem cadeado,
        permissão negada), o plano B falava em "Ctrl+C" — instrução de
        computador para quem está no celular. Agora a tela mostra o protocolo
        e o código em letra grande, para a pessoa anotar ou dar um print, e
        pede a confirmação de que guardou. [S4-I]
      */
      setMostrarChaves(true);
    }
  }

  function dismissResult(next: "track" | "new") {
    if (result?.is_anonymous && !copiedKeys) {
      setCopyError(
        "Copie o protocolo e o código antes de sair — esta é a única forma de acompanhar a denúncia anônima.",
      );
      return;
    }
    if (next === "track" && result) {
      setTrackProtocol(result.protocol);
      setTrackCode(result.access_code);
      setMode("track");
    }
    setResult(null);
    setCopiedKeys(false);
    setCopyError(null);
  }

  return (
    <div>
      <PageHeader
        title={semEmpresa ? "Acompanhar denúncia" : "Fazer denúncia"}
        description={
          semEmpresa
            ? "Com o protocolo e o código você acompanha um relato deste portal, sem entrar e sem dizer de qual empresa é."
            : publico
              ? "Canal confidencial e anônimo. O portal não guarda quem enviou."
              : "Canal confidencial. Por padrão o relato é anônimo."
        }
        actions={
          /* Sem a empresa, "Nova denúncia" não teria para onde ir. [CB-63] */
          semEmpresa ? undefined : (
            <div className="form-actions">
              <Button
                variant={mode === "new" ? "primary" : "secondary"}
                onClick={() => {
                  setMode("new");
                  setError(null);
                }}
              >
                Nova denúncia
              </Button>
              <Button
                variant={mode === "track" ? "primary" : "secondary"}
                onClick={() => {
                  setMode("track");
                  setError(null);
                }}
              >
                Acompanhar
              </Button>
            </div>
          )
        }
      />

      {!semEmpresa && mode === "new" && result && (
        <section className="form-section" role="status">
          <h2>Denúncia registrada</h2>
          {result.is_anonymous ? (
            <>
              <p className="form-error" role="alert">
                Atenção: esta denúncia é anônima e <strong>não fica vinculada à
                sua conta</strong>. Ela <strong>não aparecerá</strong> no seu
                histórico nem em nenhum menu do portal.
              </p>
              <p>
                A <strong>única forma</strong> de acompanhar o andamento é com
                o protocolo e o código abaixo. Copie-os agora e guarde em local
                seguro — o código <strong>não será mostrado de novo</strong>.
              </p>
            </>
          ) : (
            <p className="muted">
              Guarde o protocolo e o código — o código não será mostrado de
              novo. Esta denúncia ficou vinculada ao seu nome.
            </p>
          )}
          <p>
            <strong>Protocolo:</strong> {result.protocol}
          </p>
          <p>
            <strong>Código de acesso:</strong> {result.access_code}
          </p>
          <div className="form-actions">
            <Button type="button" onClick={copyProtocolAndCode}>
              {copiedKeys
                ? "Protocolo e código copiados"
                : "Copiar protocolo e código"}
            </Button>
          </div>
          {/* O navegador não deixou copiar: mostramos em letra grande para
              anotar ou dar um print, e confirmamos. [S4-I] */}
          {mostrarChaves && !copiedKeys && (
            <div className="ethics-keys">
              <p className="muted">
                Não consegui copiar por você. Anote ou tire um print desta
                tela — é a única forma de acompanhar a denúncia anônima.
              </p>
              <p className="ethics-keys-value">{result.protocol}</p>
              <p className="ethics-keys-value">{result.access_code}</p>
              <Button type="button" onClick={() => setCopiedKeys(true)}>
                Guardei o protocolo e o código
              </Button>
            </div>
          )}
          {copyError && <p className="form-error">{copyError}</p>}
          {result.is_anonymous && !copiedKeys && (
            <p className="form-hint">
              Confirme a cópia para liberar as próximas ações.
            </p>
          )}
          <div className="form-actions" style={{ marginTop: "0.75rem" }}>
            <Button
              type="button"
              disabled={result.is_anonymous && !copiedKeys}
              onClick={() => dismissResult("track")}
            >
              Acompanhar este protocolo
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={result.is_anonymous && !copiedKeys}
              onClick={() => dismissResult("new")}
            >
              Nova denúncia
            </Button>
          </div>
        </section>
      )}

      {!semEmpresa && mode === "new" && !result && (
        <section className="form-section">
          <h2>Novo relato</h2>
          {/* Fora do portal não existe a escolha: prometer que existe
              seria mentir na tela. [S4-L] */}
          <p className="muted">
            Descreva o fato com o máximo de detalhes possível.{" "}
            {publico
              ? "Este canal é anônimo."
              : "Você pode optar por se identificar ou permanecer anônimo."}
          </p>
          <form className="form-grid" onSubmit={onSubmitNew}>
            <label className="form-field">
              Categoria
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                required
              >
                {categories.map((id) => (
                  <option key={id} value={id}>
                    {REPORT_CATEGORY_LABEL[id] ?? id}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              Descrição
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                minLength={20}
                placeholder="O que aconteceu, quando, onde e quem estava envolvido…"
              />
            </label>
            {/* Fora do portal não há nome a vincular: o canal público é
                anônimo, e dizê-lo é o ponto do S4-L. */}
            {publico ? (
              <p className="form-hint">
                Esta denúncia é anônima. O portal não guarda quem a enviou —
                nem o seu nome, nem o seu usuário.
              </p>
            ) : (
              <>
                <label className="form-field" style={{ flexDirection: "row", alignItems: "center", gap: "0.55rem" }}>
                  <input
                    type="checkbox"
                    checked={isAnonymous}
                    onChange={(e) => setIsAnonymous(e.target.checked)}
                  />
                  <span>Enviar de forma anônima (recomendado)</span>
                </label>
                {!isAnonymous && (
                  <p className="form-hint" role="note">
                    Se desmarcar o anonimato, a denúncia será vinculada ao seu
                    nome ({user?.name}). Uma confirmação será pedida antes do
                    envio.
                  </p>
                )}
              </>
            )}
            {/*
              Sem esta pergunta, a denúncia contra alguém do comitê chegava
              a essa pessoa junto com todo o comitê, e só saía da vista dela
              depois que outra pessoa a marcasse como envolvida. [B3-3-H]
            */}
            <label
              className="form-field"
              style={{ flexDirection: "row", alignItems: "flex-start", gap: "0.55rem" }}
            >
              <input
                type="checkbox"
                checked={envolveComite}
                onChange={(e) => setEnvolveComite(e.target.checked)}
              />
              <span>
                Alguém do comitê de ética está envolvido neste fato
                <span className="form-hint" style={{ display: "block" }}>
                  Se marcar, esta denúncia não vai ao comitê: vai a quem é
                  dono da conta, que confere quem ela envolve antes de
                  qualquer outra pessoa ver.
                </span>
              </span>
            </label>
            {error && <p className="form-error">{error}</p>}
            <div className="form-actions">
              <Button type="submit" disabled={saving}>
                {saving ? "Enviando…" : "Enviar denúncia"}
              </Button>
              {/* Fora do portal não há para onde "voltar". [S4-L] */}
              {!publico && (
                <Link to="/" className="muted">
                  Voltar
                </Link>
              )}
            </div>
          </form>
        </section>
      )}

      {mode === "track" && (
        <section className="form-section">
          {/* Sem empresa a tela inteira é esta, e o título já o diz: dois
              "Acompanhar denúncia" seguidos só ocupavam espaço. [CB-63] */}
          {!semEmpresa && <h2>Acompanhar denúncia</h2>}
          <p className="muted">
            Use o protocolo e o código de acesso gerados no envio.
          </p>
          {/*
            Aqui o endereço não trouxe a empresa: quem chegou pela tela de
            entrada consegue acompanhar, mas para um relato novo é preciso o
            endereço que a empresa divulga — é ele que diz de quem é o canal.
            [CB-63]
          */}
          {semEmpresa && (
            <p className="form-hint">
              Para enviar um relato novo, use o endereço do canal que a sua
              empresa divulgou — no quadro de avisos, no contracheque, na
              intranet ou no contrato. É esse endereço que diz de qual empresa
              é o relato. Quem administra o portal da empresa encontra o
              endereço em Conta e usuários.
            </p>
          )}
          <form className="form-grid cols-2" onSubmit={onTrack}>
            <label className="form-field">
              Protocolo
              <input
                value={trackProtocol}
                onChange={(e) => setTrackProtocol(e.target.value)}
                required
                placeholder="CX-1234"
              />
            </label>
            <label className="form-field">
              Código de acesso
              <input
                value={trackCode}
                onChange={(e) => setTrackCode(e.target.value)}
                required
                autoComplete="off"
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <div className="form-actions">
              <Button type="submit" disabled={saving}>
                {saving ? "Buscando…" : "Consultar"}
              </Button>
            </div>
          </form>

          {tracked && (
            <div style={{ marginTop: "1.25rem", display: "grid", gap: "0.85rem" }}>
              <p style={{ margin: 0 }}>
                <strong>{tracked.protocol}</strong> · {REPORT_CATEGORY_LABEL[tracked.category] ?? tracked.category} ·{" "}
                {REPORT_STATUS_LABEL[tracked.status] ?? tracked.status}
                {tracked.isAnonymous ? " · Anônimo" : " · Identificado"}
              </p>
              <p className="muted" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{tracked.description}</p>
              {tracked.status === "AWAITING_INFO" && (
                <p className="form-hint" style={{ margin: 0 }}>
                  O comitê pediu mais informações. Responda abaixo.
                </p>
              )}
              <EthicsThread messages={tracked.messages} viewer="REPORTER" />
              {tracked.status === "RESOLVED" || tracked.status === "ARCHIVED" ? (
                <p className="muted" style={{ margin: 0 }}>
                  <strong>Relato encerrado.</strong>
                  {tracked.resolutionNote ? ` ${tracked.resolutionNote}` : ""}
                </p>
              ) : (
                <form className="form-grid" onSubmit={onAnswer}>
                  <label className="form-field">
                    Responder ao comitê
                    <textarea
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      placeholder={
                        tracked.isAnonymous
                          ? "Sua resposta continua anônima. Evite escrever algo que identifique você."
                          : "Escreva sua resposta ao comitê."
                      }
                      required
                    />
                  </label>
                  {answerError && <p className="form-error">{answerError}</p>}
                  <div className="form-actions">
                    <Button type="submit" disabled={answering || !answer.trim()}>
                      {answering ? "Enviando…" : "Enviar resposta"}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
