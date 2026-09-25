import { FormEvent, Fragment, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  createAnnouncement,
  fetchAnnouncements,
  markAnnouncementRead,
  type AnnouncementKind,
  type AnnouncementListItem,
} from "@/api/announcements";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { MarkdownBody } from "@/components/MarkdownBody";
import { PageHeader } from "@/components/PageHeader";
import { ANNOUNCEMENT_KIND_LABEL, formatDay } from "@/lib/labels";
import "@/components/data-table.css";
import "@/components/form.css";
import "./mural.css";

function canPublishAnnouncements(
  permission: string,
  role: string | undefined,
): boolean {
  return (
    permission === "master" ||
    permission === "owner" ||
    permission === "admin" ||
    permission === "rh" ||
    role === "RH"
  );
}

export function AnnouncementsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canPublish = canPublishAnnouncements(
    user?.permission ?? "user",
    user?.role,
  );
  const [rows, setRows] = useState<AnnouncementListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const [kind, setKind] = useState<AnnouncementKind>("NOTICE");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [happensAt, setHappensAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOk, setFormOk] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

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
    if (open) setOpenId(open);
  }, [searchParams]);

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
                _count: { reads: r._count.reads + (r.read_at ? 0 : 1) },
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
      const created = await createAnnouncement({
        kind,
        title,
        body,
        happens_at: happensAt || null,
        expires_at: expiresAt || null,
      });
      const url = `${window.location.origin}/mural?open=${created.id}`;
      setShareUrl(url);
      setFormOk("Aviso publicado.");
      setTitle("");
      setBody("");
      setHappensAt("");
      setExpiresAt("");
      setKind("NOTICE");
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
            O conteúdo aceita Markdown (títulos, listas, negrito). Após
            publicar, compartilhe o link com a equipe.
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
              Conteúdo (Markdown)
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                required
                minLength={10}
                placeholder={"## Título\n\nTexto do aviso, **negrito**, listas…"}
              />
            </label>
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
              <Button type="submit" disabled={publishing}>
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
        <div className="data-table-wrap">
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
                      <td>{r._count.reads}</td>
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
                                {r.happensAt && (
                                  <Chip>Evento: {formatDay(r.happensAt)}</Chip>
                                )}
                                {r.expiresAt && (
                                  <Chip>Expira: {formatDay(r.expiresAt)}</Chip>
                                )}
                              </div>
                              <MarkdownBody>{r.body}</MarkdownBody>
                              <div className="mural-expand-actions">
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
