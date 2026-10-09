import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
} from "@/api/notifications";
import "./notification-bell.css";

function quando(value: string): string {
  const minutos = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutos < 1) return "agora";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  return new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/** Os avisos do portal, com o que ainda não foi lido em destaque. */
export function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const d = await fetchNotifications();
      setItems(d.notifications);
      setUnread(d.unread);
    } catch {
      /* a caixa de avisos não derruba a tela */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Fecha ao clicar fora ou com Esc.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function abrir(n: Notification) {
    setOpen(false);
    if (!n.readAt) {
      await markNotificationRead(n.id).catch(() => undefined);
      await load();
    }
    if (n.link) navigate(n.link);
  }

  return (
    <div className="bell" ref={box}>
      <button
        type="button"
        className="bell-btn"
        aria-label={unread > 0 ? `Avisos: ${unread} não lidos` : "Avisos"}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void load();
        }}
      >
        <span aria-hidden>🔔</span>
        {unread > 0 && <span className="bell-count">{unread > 9 ? "9+" : unread}</span>}
      </button>

      {open && (
        <div className="bell-panel" role="dialog" aria-label="Avisos">
          <div className="bell-head">
            <strong>Avisos</strong>
            {unread > 0 && (
              <button
                type="button"
                className="bell-link"
                onClick={async () => {
                  await markAllNotificationsRead().catch(() => undefined);
                  await load();
                }}
              >
                Marcar todos como lidos
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="bell-empty muted">Nada por aqui.</p>
          ) : (
            <ul className="bell-list">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={`bell-item${n.readAt ? "" : " is-unread"}`}
                    onClick={() => void abrir(n)}
                  >
                    <span className="bell-item-title">{n.title}</span>
                    {n.body && <span className="muted">{n.body}</span>}
                    <span className="muted bell-when">{quando(n.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
