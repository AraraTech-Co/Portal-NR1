import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { NAV_GROUPS, type NavGroup } from "./nav";
import { canReadModule } from "@/lib/module-access";
import "./sidebar.css";

const COLLAPSED_KEY = "nr1.nav.collapsed";

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): string {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function getServerSnapshot(): string {
  return "[]";
}

function persist(next: string[]) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  for (const listener of listeners) listener();
}

function parseCollapsed(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

type Props = {
  mobileOpen: boolean;
  onCloseMobile: () => void;
};

export function Sidebar({ mobileOpen, onCloseMobile }: Props) {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const collapsed = useMemo(() => parseCollapsed(raw), [raw]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseMobile();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen, onCloseMobile]);

  function toggleGroup(title: string) {
    persist(
      collapsed.includes(title)
        ? collapsed.filter((item) => item !== title)
        : [...collapsed, title],
    );
  }

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  const nav = (
    <nav className="sidebar-nav" aria-label="Principal">
      <Link to="/" className="sidebar-brand" onClick={onCloseMobile}>
        <span className="sidebar-brand-mark" aria-hidden>
          A
        </span>
        Portal NR-1
      </Link>

      <Link
        to="/"
        className={`sidebar-link${pathname === "/" ? " is-active" : ""}`}
        aria-current={pathname === "/" ? "page" : undefined}
        onClick={onCloseMobile}
      >
        Início
      </Link>

      {NAV_GROUPS.map((group: NavGroup) => {
        const visibleItems = group.items.filter((item) =>
          canReadModule(user?.modules, item.moduleId),
        );
        if (visibleItems.length === 0) return null;

        const hasActive = visibleItems.some((item) => isActive(item.href));
        const isOpen = hasActive || !collapsed.includes(group.title);
        const panelId = `nav-${group.title.replace(/\s+/g, "-").toLowerCase()}`;

        return (
          <div key={group.title} className="sidebar-group">
            <button
              type="button"
              className="sidebar-group-toggle label-cond"
              onClick={() => toggleGroup(group.title)}
              aria-expanded={isOpen}
              aria-controls={panelId}
              disabled={hasActive}
            >
              <span>{group.title}</span>
              <span className={`sidebar-chevron${isOpen ? " is-open" : ""}`} aria-hidden>
                ▾
              </span>
            </button>
            {isOpen && (
              <ul id={panelId} className="sidebar-list">
                {visibleItems.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        to={item.href}
                        className={`sidebar-link${active ? " is-active" : ""}`}
                        aria-current={active ? "page" : undefined}
                        onClick={onCloseMobile}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}

      <div className="sidebar-footer">
        {user && (
          <p className="sidebar-user">
            <strong>{user.name}</strong>
            <span className="muted">{user.organization.name}</span>
          </p>
        )}
        <button
          type="button"
          className="sidebar-logout"
          onClick={async () => {
            onCloseMobile();
            await logout();
          }}
        >
          Sair
        </button>
      </div>
    </nav>
  );

  return (
    <>
      <aside className="sidebar sidebar-desktop">{nav}</aside>
      {mobileOpen && (
        <div className="sidebar-drawer">
          <button
            type="button"
            className="sidebar-backdrop"
            aria-label="Fechar menu"
            onClick={onCloseMobile}
          />
          <aside className="sidebar sidebar-mobile" role="dialog" aria-modal="true">
            <button
              type="button"
              className="sidebar-close"
              onClick={onCloseMobile}
              aria-label="Fechar"
            >
              ×
            </button>
            {nav}
          </aside>
        </div>
      )}
    </>
  );
}
