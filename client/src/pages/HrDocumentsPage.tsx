import { FormEvent, useEffect, useState } from "react";
import { useResourceList } from "@/hooks/useResourceList";
import {
  acknowledgeHrDocument,
  fetchEmployeeProfiles,
  fetchHrDocuments,
  publishHrDocument,
} from "@/api/modules";
import { fetchEstablishments } from "@/api/operation";
import { fileToBase64 } from "@/api/payslips";
import { baixarArquivoPrivado } from "@/api/arquivo-privado";
import { useAuth } from "@/auth/AuthContext";
import { ListShell } from "@/components/ListShell";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { formatDay, HR_DOCUMENT_KIND_LABEL } from "@/lib/labels";
import { canChangePersonnelRecord, useModuleAccess } from "@/lib/module-access";
import "@/components/form.css";

type Destino = "empresa" | "filial" | "pessoa";

/**
 * Publicar documento: para uma pessoa, uma filial ou a empresa inteira
 * (desenho de 13/11, item 10). RH, Master e Dono publicam os três; o ADM loja
 * só o geral de uma filial que gere — o servidor confere o mesmo.
 */
function PublicarDocumento({ onPublished }: { onPublished: () => void }) {
  const { user } = useAuth();
  const centralDoPessoal = canChangePersonnelRecord(user?.permission);
  const [filiais, setFiliais] = useState<{ id: string; name: string }[]>([]);
  const [pessoas, setPessoas] = useState<{ id: string; name: string }[]>([]);
  const [destino, setDestino] = useState<Destino>(centralDoPessoal ? "empresa" : "filial");
  const [filial, setFilial] = useState("");
  const [pessoa, setPessoa] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("TERM");
  const [description, setDescription] = useState("");
  const [requiresAck, setRequiresAck] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  /* Trocar a chave limpa o campo de arquivo depois de publicar. */
  const [campoDoArquivo, setCampoDoArquivo] = useState(0);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  useEffect(() => {
    fetchEstablishments()
      .then((d) => {
        const gere = new Set(user?.managed_units ?? []);
        const lista = d.establishments
          .filter((e) => centralDoPessoal || gere.has(e.id))
          .map((e) => ({ id: e.id, name: e.name }));
        setFiliais(lista);
        if (lista.length === 1) setFilial(lista[0]!.id);
      })
      .catch(() => setFiliais([]));
    if (centralDoPessoal) {
      fetchEmployeeProfiles()
        .then((rows) =>
          setPessoas(
            rows
              .filter((r) => !r.dismissedAt)
              .map((r) => ({ id: r.user.id, name: r.user.name }))
              .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
          ),
        )
        .catch(() => setPessoas([]));
    }
  }, [centralDoPessoal, user?.managed_units]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setFeito(null);
    if (!file) {
      setErro("Anexe o arquivo do documento.");
      return;
    }
    if (destino === "filial" && !filial) {
      setErro("Escolha a filial.");
      return;
    }
    if (destino === "pessoa" && !pessoa) {
      setErro("Escolha a pessoa.");
      return;
    }
    setSaving(true);
    try {
      await publishHrDocument({
        kind,
        title: title.trim(),
        description: description.trim() || undefined,
        requires_ack: requiresAck,
        ...(destino === "filial" ? { establishment_id: filial } : {}),
        ...(destino === "pessoa" ? { target_user_id: pessoa } : {}),
        file_name: file.name,
        mime_type: file.type || "application/pdf",
        content_base64: await fileToBase64(file),
      });
      setFeito("Documento publicado. Quem recebe foi avisado.");
      setTitle("");
      setDescription("");
      setRequiresAck(false);
      setFile(null);
      setCampoDoArquivo((n) => n + 1);
      onPublished();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao publicar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="form-section">
      <h2>Publicar documento</h2>
      <form className="form-grid" onSubmit={onSubmit}>
        <div className="form-grid cols-2">
          <label className="form-field">
            Título
            <input value={title} onChange={(e) => setTitle(e.target.value)} required disabled={saving} />
          </label>
          <label className="form-field">
            Tipo
            <select value={kind} onChange={(e) => setKind(e.target.value)} disabled={saving}>
              {Object.entries(HR_DOCUMENT_KIND_LABEL).map(([codigo, rotulo]) => (
                <option key={codigo} value={codigo}>
                  {rotulo}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-grid cols-2">
          <label className="form-field">
            Para
            <select value={destino} onChange={(e) => setDestino(e.target.value as Destino)} disabled={saving}>
              {centralDoPessoal && <option value="empresa">Todas as filiais</option>}
              <option value="filial">Uma filial</option>
              {centralDoPessoal && <option value="pessoa">Uma pessoa</option>}
            </select>
          </label>
          {destino === "filial" && (
            <label className="form-field">
              Filial
              <select value={filial} onChange={(e) => setFilial(e.target.value)} disabled={saving} required>
                {filiais.length !== 1 && <option value="">Escolha a filial</option>}
                {filiais.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {destino === "pessoa" && (
            <label className="form-field">
              Pessoa
              <select value={pessoa} onChange={(e) => setPessoa(e.target.value)} disabled={saving} required>
                <option value="">Escolha a pessoa</option>
                {pessoas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <label className="form-field">
          Descrição (opcional)
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={saving} />
        </label>
        <label className="form-field">
          Arquivo (PDF, PNG ou JPG)
          <input
            key={campoDoArquivo}
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={saving}
            required
          />
          <span className="form-hint">Até 20 MB. Quem recebe é avisado no portal.</span>
        </label>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={requiresAck}
            onChange={(e) => setRequiresAck(e.target.checked)}
            disabled={saving}
          />{" "}
          Exige ciência de quem recebe
        </label>
        {erro && (
          <p className="form-error" role="alert">
            {erro}
          </p>
        )}
        {feito && (
          <p className="form-success" role="status">
            {feito}
          </p>
        )}
        <div className="form-actions">
          <Button type="submit" disabled={saving}>
            {saving ? "Publicando…" : "Publicar documento"}
          </Button>
        </div>
      </form>
    </section>
  );
}

/** Para quem é o documento, como a lista mostra. */
function destinoDoDocumento(r: {
  target: { name: string } | null;
  establishment: { name: string } | null;
}): string {
  if (r.target) return r.target.name;
  if (r.establishment) return `Filial ${r.establishment.name}`;
  return "Todas as filiais";
}

export function HrDocumentsPage() {
  const { canWrite } = useModuleAccess("documentos_rh");
  const { rows, loading, error, reload } = useResourceList(fetchHrDocuments);
  const [baixando, setBaixando] = useState<string | null>(null);
  const [dandoCiencia, setDandoCiencia] = useState<string | null>(null);
  const [erroDoArquivo, setErroDoArquivo] = useState<string | null>(null);

  /* O arquivo sai para a pessoa destinatária e para o RH. */
  async function baixar(id: string, fileName: string) {
    setBaixando(id);
    setErroDoArquivo(null);
    try {
      await baixarArquivoPrivado(`/api/hr-documents/${id}/arquivo`, fileName);
    } catch (err) {
      setErroDoArquivo(err instanceof Error ? err.message : "Falha ao baixar o arquivo");
    } finally {
      setBaixando(null);
    }
  }

  /* A ciência é de quem recebe: documento dela ou de todos. */
  async function darCiencia(id: string) {
    setDandoCiencia(id);
    setErroDoArquivo(null);
    try {
      await acknowledgeHrDocument(id);
      reload();
    } catch (err) {
      setErroDoArquivo(err instanceof Error ? err.message : "Falha ao dar ciência");
    } finally {
      setDandoCiencia(null);
    }
  }

  return (
    <ListShell
      title="Documentos"
      description="Políticas e documentos de RH com ciência do colaborador."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhum documento"
      emptyDescription="Documentos publicados pelo RH aparecem aqui."
      before={canWrite ? <PublicarDocumento onPublished={reload} /> : undefined}
    >
      {erroDoArquivo && (
        <p className="form-error" role="alert">
          {erroDoArquivo}
        </p>
      )}
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Título</th>
              <th>Tipo</th>
              <th>Destino</th>
              <th>Publicado por</th>
              <th>Ciências</th>
              <th>Minha ciência</th>
              <th>Criado em</th>
              <th>Arquivo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              return (
                <tr key={r.id}>
                  <td>
                    <strong>{r.title}</strong>
                  </td>
                  <td>{HR_DOCUMENT_KIND_LABEL[r.kind] ?? r.kind}</td>
                  <td>{destinoDoDocumento(r)}</td>
                  <td>{r.publishedBy.name}</td>
                  <td>{r._count.acks}</td>
                  <td>
                    {r.my_ack?.acknowledgedAt ? (
                      <Chip tone="success">OK</Chip>
                    ) : r.can_ack ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="compact"
                        onClick={() => void darCiencia(r.id)}
                        disabled={dandoCiencia !== null}
                      >
                        {dandoCiencia === r.id ? "…" : "Dar ciência"}
                      </Button>
                    ) : r.requiresAck ? (
                      <Chip tone="warning">Pendente</Chip>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{formatDay(r.createdAt)}</td>
                  <td>
                    {r.can_download ? (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void baixar(r.id, r.fileName)}
                        disabled={baixando !== null}
                      >
                        {baixando === r.id ? "…" : "Baixar"}
                      </Button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ListShell>
  );
}
