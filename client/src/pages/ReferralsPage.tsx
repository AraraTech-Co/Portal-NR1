import { useState } from "react";
import { useResourceList } from "@/hooks/useResourceList";
import {
  createReferral,
  fetchReferrals,
  updateReferralStatus,
} from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { NewRecordSection } from "@/components/NewRecordSection";
import { formatDay, REFERRAL_STATUS_LABEL } from "@/lib/labels";
import { useModuleAccess } from "@/lib/module-access";

/** Para onde a indicação pode andar, a partir de onde ela está. */
const ANDAMENTO: Array<{ status: string; label: string }> = [
  { status: "IN_PROCESS", label: "Em processo" },
  { status: "HIRED", label: "Contratado" },
  { status: "DISCARDED", label: "Descartar" },
];

function tom(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "HIRED") return "success";
  if (status === "RECEIVED") return "warning";
  if (status === "DISCARDED") return "danger";
  return "neutral";
}

/**
 * Banco de talentos: indicar e acompanhar.
 *
 * A tela recebia a indicação e não havia como mudar a situação — a rota
 * existia no servidor e tela nenhuma a usava —, nem mostrava o contato ou o
 * motivo, que é com o que se age. [CB-64] [OB-4]
 */
export function ReferralsPage() {
  const { rows, loading, error, reload } = useResourceList(fetchReferrals);
  /* Indicar é de quem trabalha aqui: escrever basta. [OB-4] */
  const { canWrite, canManage } = useModuleAccess("talentos");
  const [mudando, setMudando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function mudar(id: string, status: string) {
    setMudando(id);
    setErro(null);
    try {
      await updateReferralStatus(id, status);
      reload();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao mudar a situação");
    } finally {
      setMudando(null);
    }
  }
  const [nome, setNome] = useState("");
  const [vaga, setVaga] = useState("");
  const [contato, setContato] = useState("");
  const [nota, setNota] = useState("");

  return (
    <ListShell
      title="Banco de talentos"
      description="Indicações de candidatos."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhuma indicação"
      emptyDescription="Indique candidatos ou acompanhe as indicações do RH."
      before={
        <NewRecordSection
          canWrite={canWrite}
          openLabel="Indicar alguém"
          title="Indicação de candidato"
          description="Quem conhece o trabalho sabe quem daria conta dele."
          submitLabel="Enviar indicação"
          disabled={!nome.trim() || !vaga.trim()}
          onSubmit={async () => {
            await createReferral({
              candidate_name: nome.trim(),
              position: vaga.trim(),
              email: contato.includes("@") ? contato.trim() : undefined,
              phone: contato && !contato.includes("@") ? contato.trim() : undefined,
              note: nota.trim() || undefined,
            });
            setNome("");
            setVaga("");
            setContato("");
            setNota("");
            await reload();
            return "Indicação enviada ao RH.";
          }}
        >
          <div className="form-grid cols-2">
            <label className="form-field">
              Nome do candidato
              <input value={nome} onChange={(e) => setNome(e.target.value)} required />
            </label>
            <label className="form-field">
              Para qual vaga ou função
              <input value={vaga} onChange={(e) => setVaga(e.target.value)} required />
            </label>
          </div>
          <label className="form-field">
            E-mail ou telefone (opcional)
            <input
              value={contato}
              onChange={(e) => setContato(e.target.value)}
              placeholder="nome@exemplo.com ou (19) 90000-0000"
            />
          </label>
          <label className="form-field">
            Por que você indica (opcional)
            <textarea value={nota} onChange={(e) => setNota(e.target.value)} />
          </label>
        </NewRecordSection>
      }
    >
      <>
        {erro && (
          <p className="page-error" role="alert">
            {erro}
          </p>
        )}
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                  <th>Candidato</th>
                  <th>Vaga</th>
                  <th>Situação</th>
                  <th>Criado em</th>
                  {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                    <td>
                      <strong>{r.candidateName}</strong>
                      {/* Contato e motivo: é com isso que se chama a pessoa. */}
                      {(r.email || r.phone) && (
                        <div className="muted">{r.email ?? r.phone}</div>
                      )}
                      {r.note && <div className="muted">{r.note}</div>}
                    </td>
                    <td>{r.position}</td>
                    <td>
                      <Chip tone={tom(r.status)}>
                        {REFERRAL_STATUS_LABEL[r.status] ?? r.status}
                      </Chip>
                    </td>
                    <td>{formatDay(r.createdAt)}</td>
                    {canManage && (
                      <td>
                        <div className="form-actions">
                          {ANDAMENTO.filter((a) => a.status !== r.status).map(
                            (a) => (
                              <Button
                                key={a.status}
                                type="button"
                                variant={
                                  a.status === "HIRED" ? "primary" : "secondary"
                                }
                                disabled={mudando === r.id}
                                onClick={() => void mudar(r.id, a.status)}
                              >
                                {a.label}
                              </Button>
                            ),
                          )}
                        </div>
                      </td>
                    )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    </ListShell>
  );
}
