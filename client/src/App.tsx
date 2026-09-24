import { useEffect, useState } from "react";
import {
  clearToken,
  fetchSession,
  getToken,
  logout,
  SessionUser,
} from "./api/auth";
import LoginView from "./views/LoginView";

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setBooting(false);
      return;
    }
    fetchSession()
      .then((data) => setUser(data.user))
      .catch(() => clearToken())
      .finally(() => setBooting(false));
  }, []);

  if (booting) {
    return (
      <main className="shell">
        <p className="muted">Carregando…</p>
      </main>
    );
  }

  if (!user) {
    return <LoginView onSuccess={setUser} />;
  }

  return (
    <main className="shell">
      <h1>Portal NR1</h1>
      <p>
        Olá, <strong>{user.name}</strong>
      </p>
      <p className="muted">
        Empresa: {user.organization.name}
        <br />
        Conta: {user.account.name}
        {user.is_master
          ? " · MASTER (todas as contas)"
          : ` · ${user.account_role ?? "—"}`}
      </p>
      <button
        type="button"
        onClick={async () => {
          await logout();
          setUser(null);
        }}
      >
        Sair
      </button>
    </main>
  );
}
