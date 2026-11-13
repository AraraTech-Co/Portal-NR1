import { FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { changePassword } from "@/api/auth";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/Button";
import "./login.css";

export function ChangePasswordPage() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /*
    A troca obrigatória não dava retorno nenhum: a sessão deixava de exigir a
    troca e a tela ficava com o formulário preenchido. Na troca voluntária, o
    aviso aparecia acima do formulário, fácil de não ver. Agora, gravada a
    senha, o formulário dá lugar à confirmação, nos dois casos.
  */
  const [pronto, setPronto] = useState(false);

  /*
    A tela só abria para quem era obrigado a trocar; quem errou a senha na
    troca, ou desconfia que ela vazou, dependia de alguém redefinir por
    Pessoas e acessos. [B2-1-G]
  */
  if (!user) return <Navigate to="/login" replace />;
  const obrigado = user.must_change_password;

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
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      setPronto(true);
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
        {pronto ? (
          <div className="login-form" role="status">
            <p className="login-lead">
              <strong>Senha trocada.</strong> Use a nova senha na próxima vez que entrar.
            </p>
            <Button type="button" onClick={() => navigate("/")}>
              Ir para o início
            </Button>
          </div>
        ) : (
        <>
        <p className="login-lead muted">
          {obrigado
            ? "Sua senha é provisória. Defina uma nova senha para continuar no portal."
            : "Defina uma nova senha. A atual é pedida para confirmar que é você."}
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
            {saving ? "Salvando…" : obrigado ? "Salvar e continuar" : "Trocar a senha"}
          </Button>
          {obrigado ? (
            <Button type="button" variant="ghost" onClick={() => logout()}>
              Sair
            </Button>
          ) : (
            <Link to="/" className="login-back">
              Voltar sem trocar
            </Link>
          )}
        </form>
        </>
        )}
      </div>
      <div className="login-aside" aria-hidden>
        <div className="login-aside-mark" />
      </div>
    </div>
  );
}
