import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { ORG_ROLE_LABEL } from "@/lib/labels";
import "./contexto.css";

/**
 * Onde eu estou e com que papel. A conta ativa só aparecia no Início e
 * dentro de Conta e usuários, e a troca de conta morava lá dentro: em
 * qualquer outra tela não havia como saber em que conta se estava
 * gravando. [S1-K]
 */
export function ContextoDaConta({ onNavigate }: { onNavigate?: () => void }) {
  const { user, accounts, switchAccount } = useAuth();
  const navigate = useNavigate();
  const [aberto, setAberto] = useState(false);
  const [trocando, setTrocando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  if (!user) return null;

  const outras = accounts.filter((a) => a.id !== user.account.id);
  const papel = ORG_ROLE_LABEL[user.role] ?? user.role;
  const empresaDiferente = user.organization.name !== user.account.name;

  async function trocar(accountId: string) {
    setTrocando(accountId);
    setErro(null);
    try {
      await switchAccount(accountId);
      setAberto(false);
      onNavigate?.();
      /*
        Volta ao Início: a tela aberta podia ser de um módulo que a outra
        conta não tem, ou de um registro que não é dela.
      */
      navigate("/");
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao trocar de conta");
    } finally {
      setTrocando(null);
    }
  }

  return (
    <div className="contexto">
      <p className="contexto-quem">
        <strong>{user.name}</strong>
        <span className="muted">{papel}</span>
      </p>

      <p className="contexto-onde">
        <span className="label-cond contexto-rotulo">Conta ativa</span>
        <span className="contexto-conta">{user.account.name}</span>
        {empresaDiferente && (
          <span className="muted contexto-empresa">{user.organization.name}</span>
        )}
      </p>

      {outras.length > 0 && (
        <>
          <button
            type="button"
            className="contexto-trocar"
            aria-expanded={aberto}
            onClick={() => setAberto((v) => !v)}
          >
            {aberto
              ? "Fechar"
              : outras.length === 1
                ? "Trocar de conta (1 outra)"
                : `Trocar de conta (${outras.length} outras)`}
          </button>
          {aberto && (
            <ul className="contexto-lista">
              {outras.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    disabled={trocando !== null}
                    onClick={() => trocar(a.id)}
                  >
                    <span className="contexto-conta">{a.name}</span>
                    <span className="muted">
                      {trocando === a.id
                        ? "Trocando…"
                        : a.via_master
                          ? "Por ser master da empresa"
                          : (ORG_ROLE_LABEL[a.org_role ?? ""] ??
                            a.org_role ??
                            "—")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {erro && (
        <p className="contexto-erro" role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}
