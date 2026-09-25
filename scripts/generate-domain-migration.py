#!/usr/bin/env python3
"""Gera SQL de migração de domínio nr1_db → portal_nr1."""
from __future__ import annotations

import subprocess
from collections import defaultdict, deque

SKIP = {
    "User",
    "Organization",
    "Account",
    "Membership",
    "AccountMembership",
    "AccountInviteLink",
    "AccountJoinRequest",
    "EmailVerificationToken",
    "EmployeeProfile",  # já migrado; jobRoleId religado no fim
    "Token",
    "_prisma_migrations",
}

SELF_NULL_ON_INSERT = {
    "RiskAssessment": ["supersededById"],
}


def q(db: str, sql: str) -> str:
    return subprocess.check_output(
        [
            "docker",
            "exec",
            "sgc-postgres-primary",
            "psql",
            "-U",
            "postgres",
            "-d",
            db,
            "-tAc",
            sql,
        ],
        text=True,
    ).strip()


def cols(db: str, table: str) -> list[str]:
    sql = f"""
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = '{table}'
    ORDER BY ordinal_position
    """
    return [c for c in q(db, sql).splitlines() if c.strip()]


def col_types(db: str, table: str) -> list[tuple[str, str]]:
    sql = f"""
    SELECT a.attname,
           pg_catalog.format_type(a.atttypid, a.atttypmod)
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = '{table}'
      AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum
    """
    rows: list[tuple[str, str]] = []
    for line in q(db, sql).splitlines():
        if not line.strip():
            continue
        name, typ = line.split("|", 1)
        rows.append((name, typ))
    return rows


def main() -> None:
    tables = [
        t
        for t in q(
            "nr1_db",
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1",
        ).split()
        if t not in SKIP
    ]

    print("COUNTS (non-zero)")
    for t in tables:
        c = q("nr1_db", f'SELECT count(*) FROM "{t}"')
        if c != "0":
            print(f"  {t}\t{c}")

    fk_sql = """
    SELECT
      (SELECT relname FROM pg_class WHERE oid = conrelid) AS child,
      (SELECT relname FROM pg_class WHERE oid = confrelid) AS parent
    FROM pg_constraint
    WHERE contype = 'f'
    """
    edges: list[tuple[str, str]] = []
    for line in q("nr1_db", fk_sql).splitlines():
        if not line.strip():
            continue
        child, parent = line.split("|")
        if child == parent:
            continue  # self-FK: trata no insert
        edges.append((child, parent))

    nodes = set(tables)
    deps: dict[str, set[str]] = defaultdict(set)
    children: dict[str, set[str]] = defaultdict(set)
    for child, parent in edges:
        if child not in nodes:
            continue
        if parent in nodes:
            deps[child].add(parent)
            children[parent].add(child)

    indeg = {t: len(deps[t]) for t in nodes}
    queue = deque(sorted([t for t, d in indeg.items() if d == 0]))
    order: list[str] = []
    while queue:
        t = queue.popleft()
        order.append(t)
        for c in sorted(children[t]):
            indeg[c] -= 1
            if indeg[c] == 0:
                queue.append(c)

    if len(order) != len(nodes):
        leftover = [t for t, d in indeg.items() if d > 0]
        raise SystemExit(f"CYCLE_OR_MISSING {leftover}")

    print(f"ORDER ({len(order)} tables)")

    lines: list[str] = [
        "-- AUTO-GERADO: migração domínio nr1_db → portal_nr1",
        "-- Identidade (User/Org/Account/…) já migrada; EmployeeProfile.jobRoleId no fim.",
        "\\set ON_ERROR_STOP on",
        "",
        "SELECT dblink_connect('legacy', 'dbname=nr1_db');",
        "",
        "BEGIN;",
        "",
        "-- Libera FK JobRole → perfis antes do TRUNCATE do domínio.",
        'UPDATE "EmployeeProfile" SET "jobRoleId" = NULL;',
        "",
    ]

    rev = list(reversed(order))
    lines.append("-- DELETE em ordem reversa (TRUNCATE falha com FK de EmployeeProfile→JobRole).")
    for t in rev:
        lines.append(f'DELETE FROM "{t}";')
    lines.append("")

    for t in order:
        c_old = cols("nr1_db", t)
        c_new = cols("portal_nr1", t)
        if set(c_old) != set(c_new):
            raise SystemExit(
                f"column set mismatch {t}: "
                f"only_old={sorted(set(c_old)-set(c_new))} "
                f"only_new={sorted(set(c_new)-set(c_old))}"
            )
        # Ordem do destino (schema novo); nomes existem no legado.
        c_list = c_new

        null_cols = set(SELF_NULL_ON_INSERT.get(t, []))
        insert_list = ", ".join(f'"{c}"' for c in c_list)

        typed = col_types("portal_nr1", t)
        typed_map = dict(typed)

        if null_cols:
            legacy_cols = [c for c in c_list if c not in null_cols]
            legacy_select = ", ".join(f'"{c}"' for c in legacy_cols)
            as_clause = ", ".join(f'"{c}" {typed_map[c]}' for c in legacy_cols)
            outer_select = ", ".join(
                "NULL" if c in null_cols else f't."{c}"' for c in c_list
            )
            lines.append(f'INSERT INTO "{t}" ({insert_list})')
            lines.append(f"SELECT {outer_select}")
            lines.append("FROM dblink('legacy', $q$")
            lines.append(f'  SELECT {legacy_select} FROM "{t}"')
            lines.append(f"$q$) AS t({as_clause});")
        else:
            as_clause = ", ".join(f'"{n}" {typ}' for n, typ in typed)
            lines.append(f'INSERT INTO "{t}" ({insert_list})')
            lines.append(f"SELECT {insert_list}")
            lines.append("FROM dblink('legacy', $q$")
            lines.append(f'  SELECT {insert_list} FROM "{t}"')
            lines.append(f"$q$) AS t({as_clause});")
        lines.append("")

    # Patch self-refs
    lines += [
        "-- Self-FK RiskAssessment.supersededById",
        """UPDATE "RiskAssessment" AS r
SET "supersededById" = x."supersededById"
FROM dblink('legacy', $q$
  SELECT id, "supersededById" FROM "RiskAssessment" WHERE "supersededById" IS NOT NULL
$q$) AS x(id text, "supersededById" text)
WHERE r.id = x.id;""",
        "",
        "-- Religa jobRoleId nos perfis",
        """UPDATE "EmployeeProfile" AS p
SET "jobRoleId" = x."jobRoleId"
FROM dblink('legacy', $q$
  SELECT id, "jobRoleId" FROM "EmployeeProfile" WHERE "jobRoleId" IS NOT NULL
$q$) AS x(id text, "jobRoleId" text)
WHERE p.id = x.id;""",
        "",
        "COMMIT;",
        "",
        "SELECT dblink_disconnect('legacy');",
        "",
        """SELECT 'Establishment' AS t, count(*)::int AS c FROM "Establishment"
UNION ALL SELECT 'Sector', count(*)::int FROM "Sector"
UNION ALL SELECT 'JobRole', count(*)::int FROM "JobRole"
UNION ALL SELECT 'Hazard', count(*)::int FROM "Hazard"
UNION ALL SELECT 'Risk', count(*)::int FROM "Risk"
UNION ALL SELECT 'RiskAssessment', count(*)::int FROM "RiskAssessment"
UNION ALL SELECT 'Action', count(*)::int FROM "Action"
UNION ALL SELECT 'EthicsReport', count(*)::int FROM "EthicsReport"
UNION ALL SELECT 'Payslip', count(*)::int FROM "Payslip"
UNION ALL SELECT 'Profiles with job', count(*)::int FROM "EmployeeProfile" WHERE "jobRoleId" IS NOT NULL
UNION ALL SELECT 'User', count(*)::int FROM "User";""",
        "",
    ]

    out = "/tmp/migrate-domain-from-legacy.sql"
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"WROTE {out} ({len(lines)} lines, {len(order)} tables)")


if __name__ == "__main__":
    main()
