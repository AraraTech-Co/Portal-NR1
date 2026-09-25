import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { acceptPublicInvite, fetchPublicInvite } from "@/api/invites";
import { Button } from "@/components/Button";
import "./login.css";
import "@/components/form.css";
import { LoadingState } from "@/components/LoadingState";

export function ConvitePage() {
  const { token = "" } = useParams();
  const [meta, setMeta] = useState<{
    account_name: string;
    organization_name: string;
    label: string | null;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isExternal, setIsExternal] = useState(false);
  const [registration, setRegistration] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPublicInvite(token)
      .then((data) => {
        if (!cancelled) setMeta(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : "Convite inválido",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      if (!isExternal && !registration.trim()) {
        setFormError("Informe o número de cadastro ou selecione Externo.");
        setSaving(false);
        return;
      }
      await acceptPublicInvite(token, {
        name,
        email,
        password,
        registration: isExternal ? undefined : registration.trim(),
        is_external: isExternal,
      });
      setDone(true);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao enviar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-panel">
        <p className="login-eyebrow label-cond">Arara · SST</p>
        <h1 className="login-brand">Convite</h1>

        {loadError && (
          <>
            <p className="login-error">{loadError}</p>
            <p className="muted">
              <Link to="/login">Ir para o login</Link>
            </p>
          </>
        )}

        {!loadError && !meta && <LoadingState label="Carregando convite…" />}

        {!loadError && meta && done && (
          <>
            <p className="login-lead">
              Pedido enviado para <strong>{meta.account_name}</strong>. Aguarde
              a aprovação de um gestor para entrar.
            </p>
            <p className="muted">
              <Link to="/login">Ir para o login</Link>
            </p>
          </>
        )}

        {!loadError && meta && !done && (
          <>
            <p className="login-lead muted">
              {meta.organization_name} · {meta.account_name}
              {meta.label ? ` · ${meta.label}` : ""}
            </p>
            <form className="login-form" onSubmit={onSubmit}>
              <label className="login-field">
                Nome
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </label>
              <label className="login-field">
                E-mail
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </label>
              <label
                className="login-field"
                style={{ flexDirection: "row", alignItems: "center", gap: "0.55rem" }}
              >
                <input
                  type="checkbox"
                  checked={isExternal}
                  onChange={(e) => {
                    setIsExternal(e.target.checked);
                    if (e.target.checked) setRegistration("");
                  }}
                />
                <span>Sou externo (sem número de cadastro)</span>
              </label>
              {!isExternal && (
                <label className="login-field">
                  Número de cadastro
                  <input
                    value={registration}
                    onChange={(e) => setRegistration(e.target.value)}
                    required
                    autoComplete="off"
                    placeholder="Ex.: 000056"
                  />
                </label>
              )}
              <label className="login-field">
                Senha
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </label>
              {formError && <p className="login-error">{formError}</p>}
              <Button type="submit" disabled={saving}>
                {saving ? "Enviando…" : "Pedir acesso"}
              </Button>
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
