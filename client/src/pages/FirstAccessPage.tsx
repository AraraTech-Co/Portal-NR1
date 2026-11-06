import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createFirstPassword, verifyFirstAccess } from "@/api/first-access";
import { Button } from "@/components/Button";
import "./login.css";

/**
 * Primeiro acesso, sem papel: a pessoa informa matrícula, CPF e data de
 * nascimento, e cria a própria senha. Qualquer erro dá a mesma mensagem —
 * a tela não diz qual dado errou. [C1-7]
 */
export function FirstAccessPage() {
  const navigate = useNavigate();
  const [matricula, setMatricula] = useState("");
  const [cpf, setCpf] = useState("");
  const [nascimento, setNascimento] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onConferir(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await verifyFirstAccess({ matricula, cpf, nascimento });
      setToken(r.token);
      /* Os dados conferidos não ficam na tela depois de usados. */
      setCpf("");
      setNascimento("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível conferir.");
    } finally {
      setLoading(false);
    }
  }

  async function onCriar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (senha.length < 8) {
      setError("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (senha !== confirmacao) {
      setError("As duas senhas não são iguais.");
      return;
    }
    setLoading(true);
    try {
      await createFirstPassword({ token: token!, password: senha, password_confirmation: confirmacao });
      navigate("/login", {
        replace: true,
        state: { aviso: "Senha criada. Entre com a sua matrícula, CPF ou login e a senha nova." },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a senha.");
      /* Ficha vencida ou já usada: recomeça da conferência. */
      if (err instanceof Error && /conferem|liberado/.test(err.message)) setToken(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page login-page--solo">
      <div className="login-panel">
        <p className="login-eyebrow label-cond">Arara · SST</p>
        <h1 className="login-brand">Primeiro acesso</h1>
        {!token ? (
          <>
            <p className="login-lead muted">
              Informe a sua matrícula, o seu CPF e a sua data de nascimento, como
              estão no cadastro da empresa. Se conferirem, você cria a sua senha.
            </p>
            <form className="login-form" onSubmit={onConferir}>
              <label className="login-field">
                Matrícula
                <input
                  value={matricula}
                  onChange={(e) => setMatricula(e.target.value)}
                  autoComplete="off"
                  required
                />
              </label>
              <label className="login-field">
                CPF
                <input
                  value={cpf}
                  onChange={(e) => setCpf(e.target.value)}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="000.000.000-00"
                  required
                />
              </label>
              <label className="login-field">
                Data de nascimento
                <input
                  type="date"
                  value={nascimento}
                  onChange={(e) => setNascimento(e.target.value)}
                  required
                />
              </label>
              {error && (
                <p className="login-error" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={loading}>
                {loading ? "Conferindo…" : "Conferir"}
              </Button>
            </form>
          </>
        ) : (
          <>
            <p className="login-lead muted">
              Dados conferidos. Crie a sua senha, com pelo menos 8 caracteres. Você
              tem 10 minutos.
            </p>
            <form className="login-form" onSubmit={onCriar}>
              <label className="login-field">
                Senha nova
                <input
                  type="password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>
              <label className="login-field">
                Repita a senha
                <input
                  type="password"
                  value={confirmacao}
                  onChange={(e) => setConfirmacao(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>
              {error && (
                <p className="login-error" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={loading}>
                {loading ? "Criando…" : "Criar senha"}
              </Button>
            </form>
          </>
        )}
        <p className="login-canal">
          <Link to="/login">Voltar ao login</Link>
        </p>
      </div>
    </div>
  );
}
