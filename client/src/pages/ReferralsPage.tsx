import { useState } from "react";
import { useResourceList } from "@/hooks/useResourceList";
import { createReferral, fetchReferrals } from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { Chip } from "@/components/Chip";
import { NewRecordSection } from "@/components/NewRecordSection";
import { formatDay, REFERRAL_STATUS_LABEL } from "@/lib/labels";
import { useModuleAccess } from "@/lib/module-access";

export function ReferralsPage() {
  const { rows, loading, error, reload } = useResourceList(fetchReferrals);
  /* Indicar é de quem trabalha aqui: escrever basta. [OB-4] */
  const { canWrite } = useModuleAccess("talentos");
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
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
                <th>Candidato</th>
                <th>Vaga</th>
                <th>Status</th>
                <th>Criado em</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                  <td><strong>{r.candidateName}</strong></td>
                  <td>{r.position}</td>
                  <td>
                    <Chip>{REFERRAL_STATUS_LABEL[r.status] ?? r.status}</Chip>
                  </td>
                  <td>{formatDay(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ListShell>
  );
}
