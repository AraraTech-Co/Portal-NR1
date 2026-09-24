import { FormEvent, useState } from "react";
import { login, SessionUser } from "../api/auth";

type Props = {
  onSuccess: (user: SessionUser) => void;
};

export default function LoginView({ onSuccess }: Props) {
  const [loginId, setLoginId] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await login(loginId, password);
      onSuccess(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <h1>Portal NR1</h1>
      <p className="muted">Entre com seu login ou e-mail.</p>
      <form className="card" onSubmit={onSubmit}>
        <label>
          Login ou e-mail
          <input
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          Senha
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
