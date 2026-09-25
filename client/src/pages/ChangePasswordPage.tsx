import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { changePassword } from "@/api/auth";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/Button";
import "./login.css";

export function ChangePasswordPage() {
  const { user, setUser, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!user) return <Navigate to="/login" replace />;
  if (!user.must_change_password) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) {
      setError("A confirmação não confere com a nova senha.");
      return;
    }
    setSaving(true);
    try {
      const data = await changePassword(currentPassword, newPassword);
      setUser(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao trocar senha");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-panel">
        <p className="login-eyebrow label-cond">Segurança</p>
        <h1 className="login-brand">Trocar senha</h1>
        <p className="login-lead muted">
          Sua senha é provisória. Defina uma nova senha para continuar no
          portal.
        </p>
        <form className="login-form" onSubmit={onSubmit}>
          <label className="login-field">
            Senha atual
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              autoFocus
            />
          </label>
          <label className="login-field">
            Nova senha
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          <label className="login-field">
            Confirmar nova senha
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          {error && <p className="login-error">{error}</p>}
          <Button type="submit" disabled={saving}>
            {saving ? "Salvando…" : "Salvar e continuar"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => logout()}>
            Sair
          </Button>
        </form>
      </div>
      <div className="login-aside" aria-hidden>
        <div className="login-aside-mark" />
      </div>
    </div>
  );
}
