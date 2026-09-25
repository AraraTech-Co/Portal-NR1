import { useEffect, useState } from "react";
import {
  fetchOrgMembers,
  type OrgMember,
} from "@/api/org-members";
import "./people-picker.css";

export type OrgMemberOption = OrgMember;

type CommonProps = {
  disabled?: boolean;
  required?: boolean;
  emptyLabel?: string;
};

type SingleProps = CommonProps & {
  mode?: "single";
  value: string;
  onChange: (userId: string, member: OrgMember | null) => void;
};

type MultiProps = CommonProps & {
  mode: "multiple";
  value: string[];
  onChange: (userIds: string[], members: OrgMember[]) => void;
};

type Props = SingleProps | MultiProps;

function memberLabel(m: OrgMember): string {
  return m.jobRoleName ? `${m.name} · ${m.jobRoleName}` : m.name;
}

export function PeoplePicker(props: Props) {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchOrgMembers()
      .then((rows) => {
        if (!cancelled) setMembers(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Falha ao carregar pessoas",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const emptyLabel =
    props.emptyLabel ??
    (loading
      ? "Carregando pessoas…"
      : members.length === 0
        ? "Nenhuma pessoa cadastrada"
        : "Selecione…");

  if (props.mode === "multiple") {
    return (
      <MultiPeoplePicker
        members={members}
        loading={loading}
        error={error}
        emptyLabel={emptyLabel}
        value={props.value}
        onChange={props.onChange}
        disabled={props.disabled}
        required={props.required}
      />
    );
  }

  return (
    <div className="people-picker">
      {error && <p className="form-error">{error}</p>}
      <select
        value={props.value}
        disabled={props.disabled || loading || members.length === 0}
        required={props.required}
        onChange={(e) => {
          const id = e.target.value;
          const member = members.find((m) => m.id === id) ?? null;
          props.onChange(id, member);
        }}
      >
        <option value="">{emptyLabel}</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {memberLabel(m)}
          </option>
        ))}
      </select>
    </div>
  );
}

function MultiPeoplePicker({
  members,
  loading,
  error,
  emptyLabel,
  value,
  onChange,
  disabled,
  required,
}: {
  members: OrgMember[];
  loading: boolean;
  error: string | null;
  emptyLabel: string;
  value: string[];
  onChange: (userIds: string[], members: OrgMember[]) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  const selected = new Set(value);

  function toggle(id: string) {
    const next = selected.has(id)
      ? value.filter((x) => x !== id)
      : [...value, id];
    const picked = members.filter((m) => next.includes(m.id));
    onChange(next, picked);
  }

  return (
    <div className="people-picker">
      {error && <p className="form-error">{error}</p>}
      {!error && loading && <p className="form-hint">{emptyLabel}</p>}
      {!error && !loading && members.length === 0 && (
        <p className="form-hint">{emptyLabel}</p>
      )}
      {!error && !loading && members.length > 0 && (
        <div
          className="people-picker-list"
          role="group"
          aria-required={required || undefined}
        >
          {members.map((m) => (
            <label key={m.id} className="people-picker-option">
              <input
                type="checkbox"
                checked={selected.has(m.id)}
                disabled={disabled}
                onChange={() => toggle(m.id)}
              />
              <span>{memberLabel(m)}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
