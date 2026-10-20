import { FormEvent, Fragment, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  createAnnouncement,
  fetchAnnouncementReaders,
  fetchAnnouncements,
  markAnnouncementRead,
  type AnnouncementKind,
  type AnnouncementListItem,
  type AnnouncementReader,
} from "@/api/announcements";
import { fetchEstablishments, type Establishment } from "@/api/operation";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { MarkdownBody } from "@/components/MarkdownBody";
import { PageHeader } from "@/components/PageHeader";
import { ANNOUNCEMENT_KIND_LABEL, formatDay } from "@/lib/labels";
import { useModuleAccess } from "@/lib/module-access";
import "@/components/data-table.css";
import "@/components/form.css";
import "./mural.css";

export function AnnouncementsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { canWrite: canPublish } = useModuleAccess("mural");
  const [rows, setRows] = useState<AnnouncementListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);
  // Quem leu e quem não leu: "12 leituras" não diz a quem cobrar. [S3-H]
  const [readersOf, setReadersOf] = useState<string | null>(null);
  const [readers, setReaders] = useState<AnnouncementReader[] | null>(null);
  const [readersError, setReadersError] = useState<string | null>(null);

  async function toggleReaders(id: string) {
    if (readersOf === id) {
      setReadersOf(null);
      return;
    }
    setReadersOf(id);
    setReaders(null);
    setReadersError(null);
    try {
      const data = await fetchAnnouncementReaders(id);
      setReaders(data.readers);
    } catch (err) {
      setReadersError(err instanceof Error ? err.message : "Falha ao carregar");
    }
  }

  const [kind, setKind] = useState<AnnouncementKind>("NOTICE");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [happensAt, setHappensAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  /** Para quais unidades vai o aviso. Nenhuma marcada = a empresa toda. [CB-33] */
  const [units, setUnits] = useState<Establishment[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [scope, setScope] = useState<"empresa" | "unidades">("empresa");
  const [publishing, setPublishing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOk, setFormOk] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!canPublish) return;
    fetchEstablishments()
      .then((d) => setUnits(d.establishments.filter((u) => !u.archivedAt)))
      .catch(() => setUnits([]));
  }, [canPublish]);

  const reload = useCallback(async () => {
    const list = await fetchAnnouncements();
    setRows(list);
    return list;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    reload()
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Falha ao carregar");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => {
    const open = searchParams.get("open");
    if (!open) return;
    setOpenId(open);
    /*
      Aberto pelo link (notificação ou link compartilhado) também conta como
      lido: senão "quem leu" mente para quem cobra. [S3-H] [S4-G]
    */
    const item = rows.find((r) => r.id === open);
    if (item && !item.read_at) void ensureRead(item);
  }, [searchParams, rows]);

  async function ensureRead(item: AnnouncementListItem) {
    if (item.read_at) return;
    setMarkingId(item.id);
    try {
      await markAnnouncementRead(item.id);
      setRows((prev) =>
        prev.map((r) =>
          r.id === item.id
            ? {
                ...r,
                read_at: new Date().toISOString(),
                read_count: r.read_count + (r.read_at ? 0 : 1),
              }
            : r,
        ),
      );
    } catch {
      /* não bloqueia a leitura */
    } finally {
      setMarkingId(null);
    }
  }

  async function toggleRow(item: AnnouncementListItem) {
    const next = openId === item.id ? null : item.id;
    setOpenId(next);
    if (next) {
      setSearchParams({ open: next }, { replace: true });
      await ensureRead(item);
    } else {
      setSearchParams({}, { replace: true });
    }
  }

  async function onPublish(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormOk(null);
    setShareUrl(null);
    setPublishing(true);
    try {
      const { announcement: created, notified } = await createAnnouncement({
        kind,
        title,
        body,
        happens_at: happensAt || null,
        expires_at: expiresAt || null,
        establishment_ids: scope === "unidades" ? chosen : [],
      });
      const url = `${window.location.origin}/mural?open=${created.id}`;
      setShareUrl(url);
      /*
        Quantas pessoas receberam, na hora. Antes a tela mandava compartilhar
        um link, e quem publicava não sabia a quem o aviso tinha chegado.
        [CB-33] [S3-G]
      */
      setFormOk(
        notified === 0
          ? "Aviso publicado. Ninguém foi avisado: não há pessoas no público escolhido."
          : `Aviso publicado e enviado a ${notified} ${
              notified === 1 ? "pessoa" : "pessoas"
            }.`,
      );
      setTitle("");
      setBody("");
      setHappensAt("");
      setExpiresAt("");
      setKind("NOTICE");
      setChosen([]);
      setScope("empresa");
      setOpenId(created.id);
      setSearchParams({ open: created.id }, { replace: true });
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao publicar");
    } finally {
      setPublishing(false);
    }
  }

  async function copyShareUrl() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setFormOk("Link de acesso copiado.");
    } catch {
      setFormOk(`Link: ${shareUrl}`);
    }
  }

  return (
    <div>
      <PageHeader
        title="Mural de avisos"
        description="Comunicados internos. Clique na linha para ler o conteúdo."
      />

      {canPublish && (
        <section className="form-section">
          <h2>Publicar aviso</h2>
          <p className="muted">
            {/* "Markdown" não é termo de quem escreve o aviso. [S3-F] */}
            Para dar forma ao texto: <code>## </code> no começo da linha faz um
            título, <code>- </code> faz item de lista e{" "}
            <code>**assim**</code> deixa em negrito. Ao publicar, o portal avisa
            sozinho quem é do público — não é preciso compartilhar o link.
          </p>
          <form className="form-grid" onSubmit={onPublish}>
            <div className="form-grid cols-2">
              <label className="form-field">
                Tipo
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as AnnouncementKind)}
                >
                  {Object.entries(ANNOUNCEMENT_KIND_LABEL).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                Título
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  maxLength={200}
                />
              </label>
            </div>
            <label className="form-field">
              Conteúdo do aviso
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                required
                minLength={10}
                placeholder={"## Título\n\nTexto do aviso, **negrito**, listas…"}
              />
            </label>
            <fieldset className="mural-units">
              <legend>Quem recebe</legend>
              <label className="mural-unit">
                <input
                  type="radio"
                  name="publico"
                  checked={scope === "empresa"}
                  onChange={() => {
                    setScope("empresa");
                    setChosen([]);
                  }}
                />
                A empresa toda
              </label>
              <label className="mural-unit">
                <input
                  type="radio"
                  name="publico"
                  checked={scope === "unidades"}
                  onChange={() => setScope("unidades")}
                  disabled={units.length === 0}
                />
                Só estas unidades
              </label>
              {scope === "unidades" && (
                <div className="mural-unit-list">
                  {units.map((u) => (
                    <label key={u.id} className="mural-unit">
                      <input
                        type="checkbox"
                        checked={chosen.includes(u.id)}
                        onChange={(e) =>
                          setChosen((prev) =>
                            e.target.checked
                              ? [...prev, u.id]
                              : prev.filter((id) => id !== u.id),
                          )
                        }
                      />
                      {u.name}
                    </label>
                  ))}
                </div>
              )}
              {scope === "unidades" && chosen.length === 0 && (
                <p className="form-hint is-warning">
                  Marque pelo menos uma unidade.
                </p>
              )}
              <p className="form-hint">
                O fiscal e quem foi desligado nunca recebem aviso do mural. Num
                aviso de unidade, quem não está ligado a uma função — acesso só
                administrativo, por exemplo — também não recebe.
              </p>
            </fieldset>
            <div className="form-grid cols-2">
              <label className="form-field">
                Data do evento (opcional)
                <input
                  type="date"
                  value={happensAt}
                  onChange={(e) => setHappensAt(e.target.value)}
                />
              </label>
              <label className="form-field">
                Expira em (opcional)
                <input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
              </label>
            </div>
            {formError && <p className="form-error">{formError}</p>}
            {formOk && <p className="muted">{formOk}</p>}
            {shareUrl && (
              <div className="form-actions">
                <code style={{ fontSize: "0.85rem", wordBreak: "break-all" }}>
                  {shareUrl}
                </code>
                <Button type="button" variant="secondary" onClick={copyShareUrl}>
                  Copiar link
                </Button>
              </div>
            )}
            <div className="form-actions">
              <Button
                type="submit"
                disabled={
                  publishing || (scope === "unidades" && chosen.length === 0)
                }
              >
                {publishing ? "Publicando…" : "Publicar"}
              </Button>
            </div>
          </form>
        </section>
      )}

      {loading && <LoadingState />}
      {!loading && error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && rows.length === 0 && (
        <EmptyState
          title="Nenhum aviso"
          description="Avisos publicados pelo RH ou gestores aparecem aqui."
        />
      )}
      {!loading && !error && rows.length > 0 && (
        <div className="data-table-wrap mural-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Título</th>
                <th>Tipo</th>
                <th>Publicado por</th>
                <th>Leituras</th>
                <th>Lido</th>
                <th>Publicado em</th>
                <th aria-hidden />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const open = openId === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr
                      className={`mural-row is-clickable${open ? " is-open" : ""}`}
                      onClick={() => toggleRow(r)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          void toggleRow(r);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-expanded={open}
                    >
                      <td>
                        <strong>{r.title}</strong>
                      </td>
                      <td>
                        <Chip>{ANNOUNCEMENT_KIND_LABEL[r.kind] ?? r.kind}</Chip>
                      </td>
                      <td>{r.publishedBy.name}</td>
                      {/* "12 leituras" não dizia de quantos. [CB-36] */}
                      <td>
                        {r.read_count} de {r.audience_count}
                      </td>
                      <td>
                        {r.read_at ? (
                          <Chip tone="success">Sim</Chip>
                        ) : (
                          <Chip tone="warning">
                            {markingId === r.id ? "…" : "Não"}
                          </Chip>
                        )}
                      </td>
                      <td>{formatDay(r.createdAt)}</td>
                      <td>
                        <span className="mural-chevron" aria-hidden>
                          ▾
                        </span>
                      </td>
                    </tr>
                    <tr className="mural-expand">
                      <td colSpan={7}>
                        <div
                          className={`mural-expand-panel${open ? " is-open" : ""}`}
                        >
                          <div className="mural-expand-clip">
                            <div className="mural-expand-body">
                              <div className="mural-expand-meta">
                                {/* Para quem foi o aviso. [CB-33] */}
                                <Chip>
                                  {r.establishments.length === 0
                                    ? "Empresa toda"
                                    : r.establishments
                                        .map((u) => u.name)
                                        .join(", ")}
                                </Chip>
                                {r.happensAt && (
                                  <Chip>Evento: {formatDay(r.happensAt)}</Chip>
                                )}
                                {r.expiresAt && (
                                  <Chip>Expira: {formatDay(r.expiresAt)}</Chip>
                                )}
                              </div>
                              <MarkdownBody>{r.body}</MarkdownBody>
                              <div className="mural-expand-actions">
                                {canPublish && (
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void toggleReaders(r.id);
                                    }}
                                  >
                                    {readersOf === r.id ? "Fechar leituras" : "Quem leu"}
                                  </Button>
                                )}
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const url = `${window.location.origin}/mural?open=${r.id}`;
                                    void navigator.clipboard
                                      .writeText(url)
                                      .catch(() => {
                                        window.prompt("Copie o link:", url);
                                      });
                                  }}
                                >
                                  Copiar link
                                </Button>
                              </div>
                              {canPublish && readersOf === r.id && (
                                <div className="mural-readers" onClick={(e) => e.stopPropagation()}>
                                  {readersError && (
                                    <p className="form-error" role="alert">
                                      {readersError}
                                    </p>
                                  )}
                                  {!readersError && readers === null && (
                                    <p className="muted">Carregando…</p>
                                  )}
                                  {readers && (
                                    <>
                                      <p className="muted">
                                        {readers.filter((p) => p.read_at).length} de {readers.length}{" "}
                                        leram.{" "}
                                        {/*
                                          A conta é sobre quem devia receber:
                                          sem o fiscal, sem quem foi desligado
                                          e sem as outras unidades. [CB-36]
                                        */}
                                        <span>
                                          A conta é de quem recebeu o aviso
                                          {r.establishments.length > 0
                                            ? ` em ${r.establishments
                                                .map((u) => u.name)
                                                .join(", ")}`
                                            : ""}
                                          .
                                        </span>
                                      </p>
                                      <ul>
                                        {readers.map((p) => (
                                          <li key={p.id}>
                                            <span>{p.name}</span>
                                            {p.read_at ? (
                                              <Chip tone="success">
                                                leu em {formatDay(p.read_at)}
                                              </Chip>
                                            ) : (
                                              <Chip tone="warning">não leu</Chip>
                                            )}
                                          </li>
                                        ))}
                                      </ul>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
