import { FormEvent, useState } from "react";
import {
  archiveActivity,
  archiveEstablishment,
  updateActivity,
  updateEstablishment,
  type Activity,
  type Establishment,
  type JobRole,
} from "@/api/operation";
import { Button } from "@/components/Button";

/** Ações de editar e arquivar ficam em componentes próprios. [S2-G] [S1-H] */

function formatCnpj(value: string | null): string | null {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length !== 14) return value;
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

/** Arquivar pede confirmação; o servidor recusa se ainda houver algo embaixo. */
async function confirmArchive(what: string, run: () => Promise<unknown>): Promise<string | null> {
  if (!window.confirm(`Arquivar ${what}? Ele some das listas, mas o histórico fica.`)) return null;
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Falha ao arquivar";
  }
}

/** Estabelecimento selecionado: CNPJ e endereço, editar e arquivar. [S1-H] */
export function EstablishmentCard({
  establishment,
  canEdit,
  onChanged,
}: {
  establishment: Establishment;
  canEdit: boolean;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(establishment.name);
  const [cnpj, setCnpj] = useState(formatCnpj(establishment.taxId) ?? "");
  const [address, setAddress] = useState(establishment.address ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start() {
    setName(establishment.name);
    setCnpj(formatCnpj(establishment.taxId) ?? "");
    setAddress(establishment.address ?? "");
    setError(null);
    setEditing(true);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const originalCnpj = formatCnpj(establishment.taxId) ?? "";
      await updateEstablishment(establishment.id, {
        ...(name.trim() !== establishment.name ? { name: name.trim() } : {}),
        // CNPJ só vai quando mudou: o que veio da carga pode estar fora do padrão.
        ...(cnpj.trim() !== originalCnpj ? { tax_id: cnpj.trim() || null } : {}),
        ...(address.trim() !== (establishment.address ?? "") ? { address: address.trim() || null } : {}),
      });
      setEditing(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function onArchive() {
    const failure = await confirmArchive(`o estabelecimento “${establishment.name}”`, () =>
      archiveEstablishment(establishment.id),
    );
    if (failure) setError(failure);
    else await onChanged();
  }

  if (editing) {
    return (
      <form className="op-card op-edit" onSubmit={onSave}>
        <label className="form-field">
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="form-field">
          CNPJ
          <input value={cnpj} onChange={(e) => setCnpj(e.target.value)} inputMode="numeric" placeholder="00.000.000/0000-00" />
        </label>
        <label className="form-field">
          Endereço
          <textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rua, número, bairro, cidade/UF" />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <Button type="submit" disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="op-card">
      <dl className="op-facts">
        <div>
          <dt>CNPJ</dt>
          <dd>{formatCnpj(establishment.taxId) ?? <span className="muted">não informado</span>}</dd>
        </div>
        <div>
          <dt>Endereço</dt>
          <dd>{establishment.address ?? <span className="muted">não informado</span>}</dd>
        </div>
      </dl>
      {error && <p className="form-error">{error}</p>}
      {canEdit && (
        <div className="op-row-actions">
          <Button type="button" variant="secondary" onClick={start}>
            Editar
          </Button>
          <Button type="button" variant="ghost" onClick={() => void onArchive()}>
            Arquivar
          </Button>
        </div>
      )}
    </div>
  );
}

/** Renomear e arquivar algo que só tem nome (setor, função). */
export function NameActions({
  label,
  name,
  canEdit,
  onRename,
  onArchive,
}: {
  label: string;
  name: string;
  canEdit: boolean;
  onRename: (name: string) => Promise<void>;
  onArchive: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) return null;

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (value.trim().length < 2) {
      setError("Informe ao menos 2 caracteres.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onRename(value.trim());
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    const failure = await confirmArchive(`${label} “${name}”`, onArchive);
    if (failure) setError(failure);
  }

  return (
    <div className="op-name-actions">
      {editing ? (
        <form className="op-quick-row" onSubmit={onSave}>
          <input value={value} onChange={(e) => setValue(e.target.value)} aria-label={`Novo nome de ${label}`} autoFocus />
          <Button type="submit" variant="secondary" disabled={saving}>
            Salvar
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
        </form>
      ) : (
        <div className="op-row-actions">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setValue(name);
              setError(null);
              setEditing(true);
            }}
          >
            Renomear
          </Button>
          <Button type="button" variant="ghost" onClick={() => void archive()}>
            Arquivar
          </Button>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

/** Atividade: corrigir nome, descrição e quem executa; arquivar. [S2-G] [S1-J] */
export function ActivityCard({
  activity,
  jobRoles,
  canEdit,
  onChanged,
}: {
  activity: Activity;
  jobRoles: JobRole[];
  canEdit: boolean;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(activity.name);
  const [description, setDescription] = useState(activity.description ?? "");
  const [jobIds, setJobIds] = useState<string[]>(activity.job_role_ids);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const jobNames = jobRoles.filter((j) => activity.job_role_ids.includes(j.id)).map((j) => j.name);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!description.trim()) {
      setError("Descreva a atividade: o que a pessoa faz, com o quê e onde.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateActivity(activity.id, {
        name: name.trim(),
        description: description.trim(),
        job_role_ids: jobIds,
      });
      setEditing(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function onArchive() {
    const failure = await confirmArchive(`a atividade “${activity.name}”`, () => archiveActivity(activity.id));
    if (failure) setError(failure);
    else await onChanged();
  }

  if (editing) {
    return (
      <form className="op-activity op-edit" onSubmit={onSave}>
        <label className="form-field">
          Atividade
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="form-field">
          Como é feita
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} required />
        </label>
        {jobRoles.length > 0 && (
          <fieldset className="op-jobs">
            <legend className="muted">Quem executa</legend>
            {jobRoles.map((j) => (
              <label key={j.id} className="op-check">
                <input
                  type="checkbox"
                  checked={jobIds.includes(j.id)}
                  onChange={(e) =>
                    setJobIds((ids) =>
                      e.target.checked ? [...new Set([...ids, j.id])] : ids.filter((id) => id !== j.id),
                    )
                  }
                />
                {j.name}
              </label>
            ))}
          </fieldset>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <Button type="submit" disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="op-activity">
      <strong>{activity.name}</strong>
      {activity.description ? (
        <p className="muted">{activity.description}</p>
      ) : (
        <p className="form-error">Sem descrição — corrija para o inventário saber de onde vem o risco.</p>
      )}
      {jobNames.length > 0 && <p className="muted">Quem executa: {jobNames.join(", ")}</p>}
      {error && <p className="form-error">{error}</p>}
      {canEdit && (
        <div className="op-row-actions">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setName(activity.name);
              setDescription(activity.description ?? "");
              setJobIds(activity.job_role_ids);
              setError(null);
              setEditing(true);
            }}
          >
            Editar
          </Button>
          <Button type="button" variant="ghost" onClick={() => void onArchive()}>
            Arquivar
          </Button>
        </div>
      )}
    </div>
  );
}
