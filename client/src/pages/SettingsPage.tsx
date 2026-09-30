import { useAuth } from "@/auth/AuthContext";
import { Chip } from "@/components/Chip";
import { PageHeader } from "@/components/PageHeader";
import { PERMISSION_LABEL } from "@/lib/labels";
import "@/components/data-table.css";

export function SettingsPage() {
  const { user } = useAuth();

  return (
    <div>
      <PageHeader
        title="Configurações"
        description="Contexto da organização e da conta ativa nesta sessão."
      />
      {user && (
        <section className="form-section">
          <h2>Contexto</h2>
          <div className="data-table-wrap">
            <table className="data-table">
              <tbody>
                <tr>
                  <th>Organização</th>
                  <td>{user.organization.name}</td>
                </tr>
                <tr>
                  <th>Conta</th>
                  <td>{user.account.name}</td>
                </tr>
                <tr>
                  <th>Permissão</th>
                  <td>
                    <Chip>
                      {PERMISSION_LABEL[user.permission] ?? user.permission}
                    </Chip>
                  </td>
                </tr>
                <tr>
                  <th>Troca de senha</th>
                  <td>
                    {user.must_change_password ? (
                      <Chip tone="warning">Obrigatória</Chip>
                    ) : (
                      <Chip tone="success">Em dia</Chip>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ marginTop: "1rem" }}>
            Os módulos visíveis no menu seguem a matriz L / L/E / X do papel
            efetivo. Cadastros avançados de metodologias entram depois.
          </p>
        </section>
      )}
    </div>
  );
}
