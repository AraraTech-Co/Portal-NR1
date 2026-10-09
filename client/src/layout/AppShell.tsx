import { useState } from "react";
import { Outlet } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { isReadOnlyPermission } from "@/lib/module-access";
import { Sidebar } from "./Sidebar";
import "./shell.css";

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useAuth();

  return (
    <div className="app-shell">
      <Sidebar
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="app-main">
        <header className="app-topbar">
          <button
            type="button"
            className="app-menu-btn"
            aria-label="Abrir menu"
            onClick={() => setMobileOpen(true)}
          >
            ☰
          </button>
          <span className="app-topbar-brand font-display">Portal NR-1</span>
        </header>
        <main className="app-content">
          {isReadOnlyPermission(user?.permission) && (
            <p className="readonly-banner" role="status">
              Acesso só de consulta: você vê o que a fiscalização pede, mas nada aqui pode ser alterado.
            </p>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
