/**
 * Migra identidade/tenancy de nr1_db (Next legado) → portal_nr1 (Express).
 *
 * Adapta o modelo novo:
 *   OrgRole (legado) → Role (MASTER|ADMIN|SST|RH|COLABORADOR)
 *   AccountRole.DEVELOPER → USER
 *   Organization.active = true
 *
 * Não migra domínio SST/RH completo (hazards, ações, …) — só o necessário
 * para as pessoas entrarem: org, contas, users, vínculos, convites, perfis.
 *
 * Uso:
 *   SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... npx tsx scripts/migrate-identity-from-legacy.ts
 */
import { Client } from "pg";

type Row = Record<string, unknown>;

const SOURCE =
  process.env.SOURCE_DATABASE_URL ||
  process.env.LEGACY_DATABASE_URL ||
  "";
const TARGET =
  process.env.TARGET_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "";

if (!SOURCE || !TARGET) {
  console.error(
    "Defina SOURCE_DATABASE_URL (nr1_db) e TARGET_DATABASE_URL (portal_nr1).",
  );
  process.exit(1);
}

/** OrgRole legado → Role do Express. */
function mapOrgRole(role: string): string {
  switch (role) {
    case "MASTER":
      return "MASTER";
    case "ADMINISTRADOR_GERAL":
      return "ADMIN";
    case "GERENTE_ADMINISTRATIVO":
    case "GERENTE_LOJA":
      return "GERENTE";
    case "SUPERVISOR":
      return "SUPERVISOR";
    case "ADM_LOJA":
      return "ADM_LOJA";
    case "SST":
      return "SST";
    case "RH":
      return "RH";
    case "AUDITOR":
    case "COLABORADOR":
    default:
      return "COLABORADOR";
  }
}

function mapAccountRole(role: string): string {
  if (role === "DEVELOPER") return "USER";
  if (role === "OWNER" || role === "ADMIN" || role === "USER") return role;
  return "USER";
}

async function fetchAll(client: Client, sql: string): Promise<Row[]> {
  const res = await client.query(sql);
  return res.rows as Row[];
}

async function main() {
  const src = new Client({ connectionString: SOURCE });
  const dst = new Client({ connectionString: TARGET });
  await src.connect();
  await dst.connect();

  console.log("==> lendo legado (nr1_db)…");
  const orgs = await fetchAll(src, `SELECT * FROM "Organization" ORDER BY "createdAt"`);
  const accounts = await fetchAll(src, `SELECT * FROM "Account" ORDER BY "createdAt"`);
  const users = await fetchAll(src, `SELECT * FROM "User" ORDER BY "createdAt"`);
  const memberships = await fetchAll(src, `SELECT * FROM "Membership" ORDER BY "createdAt"`);
  const accountMemberships = await fetchAll(
    src,
    `SELECT * FROM "AccountMembership" ORDER BY "createdAt"`,
  );
  const inviteLinks = await fetchAll(
    src,
    `SELECT * FROM "AccountInviteLink" ORDER BY "createdAt"`,
  );
  const joinRequests = await fetchAll(
    src,
    `SELECT * FROM "AccountJoinRequest" ORDER BY "createdAt"`,
  );
  const emailTokens = await fetchAll(
    src,
    `SELECT * FROM "EmailVerificationToken" ORDER BY "createdAt"`,
  );
  const profiles = await fetchAll(
    src,
    `SELECT * FROM "EmployeeProfile" ORDER BY "createdAt"`,
  );

  console.log(
    `    orgs=${orgs.length} accounts=${accounts.length} users=${users.length} ` +
      `memberships=${memberships.length} acctMem=${accountMemberships.length} ` +
      `invites=${inviteLinks.length} joins=${joinRequests.length} ` +
      `emailTokens=${emailTokens.length} profiles=${profiles.length}`,
  );

  console.log("==> limpando identidade + domínio seed em portal_nr1…");
  await dst.query("BEGIN");
  try {
    // CASCADE remove Token, Membership, Account*, Hazard seed, etc.
    await dst.query(`
      TRUNCATE TABLE
        "Token",
        "EmailVerificationToken",
        "AccountJoinRequest",
        "AccountInviteLink",
        "AccountMembership",
        "Membership",
        "EmployeeProfile",
        "Account",
        "User",
        "Organization"
      CASCADE
    `);

    console.log("==> inserindo Organization…");
    for (const o of orgs) {
      await dst.query(
        `INSERT INTO "Organization" (
          id, name, "taxId", active,
          "assessmentReviewMonths", "hasSstCertification",
          "responsibleName", "responsibleRole", "responsibleRegistration",
          "createdAt", "updatedAt"
        ) VALUES ($1,$2,$3,true,$4,$5,$6,$7,$8,$9,$10)`,
        [
          o.id,
          o.name,
          o.taxId,
          o.assessmentReviewMonths ?? 24,
          o.hasSstCertification ?? false,
          o.responsibleName,
          o.responsibleRole,
          o.responsibleRegistration,
          o.createdAt,
          o.updatedAt,
        ],
      );
    }

    console.log("==> inserindo Account…");
    for (const a of accounts) {
      await dst.query(
        `INSERT INTO "Account" (
          id, "organizationId", name, active, "createdAt", "updatedAt"
        ) VALUES ($1,$2,$3,$4,$5,$6)`,
        [a.id, a.organizationId, a.name, a.active ?? true, a.createdAt, a.updatedAt],
      );
    }

    console.log("==> inserindo User (hashes preservados)…");
    for (const u of users) {
      await dst.query(
        `INSERT INTO "User" (
          id, login, email, name, "passwordHash", active,
          "emailVerifiedAt", "mustChangePassword", "createdAt", "updatedAt"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          u.id,
          u.login,
          u.email,
          u.name,
          u.passwordHash,
          u.active ?? true,
          u.emailVerifiedAt,
          u.mustChangePassword ?? false,
          u.createdAt,
          u.updatedAt,
        ],
      );
    }

    console.log("==> inserindo Membership (OrgRole → Role)…");
    const roleStats: Record<string, number> = {};
    for (const m of memberships) {
      const role = mapOrgRole(String(m.role));
      roleStats[`${m.role}→${role}`] = (roleStats[`${m.role}→${role}`] || 0) + 1;
      await dst.query(
        `INSERT INTO "Membership" (
          id, "userId", "organizationId", role, "createdAt", "updatedAt"
        ) VALUES ($1,$2,$3,$4::"Role",$5,$6)`,
        [
          m.id,
          m.userId,
          m.organizationId,
          role,
          m.createdAt,
          m.updatedAt,
        ],
      );
    }
    console.log("    mapeamento:", roleStats);

    console.log("==> inserindo AccountMembership…");
    for (const am of accountMemberships) {
      const role = mapAccountRole(String(am.role));
      await dst.query(
        `INSERT INTO "AccountMembership" (
          id, "accountId", "userId", role, "createdAt", "updatedAt"
        ) VALUES ($1,$2,$3,$4::"AccountRole",$5,$6)`,
        [am.id, am.accountId, am.userId, role, am.createdAt, am.updatedAt],
      );
    }

    console.log("==> inserindo AccountInviteLink…");
    for (const link of inviteLinks) {
      await dst.query(
        `INSERT INTO "AccountInviteLink" (
          id, "accountId", token, "roleMode", role, "orgRole",
          label, active, "expiresAt", "maxUses", "usedCount",
          "createdById", "createdAt", "updatedAt"
        ) VALUES ($1,$2,$3,$4::"InviteRoleMode",$5::"AccountRole",$6::"Role",$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          link.id,
          link.accountId,
          link.token,
          link.roleMode ?? "ON_APPROVE",
          mapAccountRole(String(link.role ?? "USER")),
          mapOrgRole(String(link.orgRole ?? "COLABORADOR")),
          link.label,
          link.active ?? true,
          link.expiresAt,
          link.maxUses,
          link.usedCount ?? 0,
          link.createdById,
          link.createdAt,
          link.updatedAt,
        ],
      );
    }

    console.log("==> inserindo AccountJoinRequest…");
    for (const jr of joinRequests) {
      await dst.query(
        `INSERT INTO "AccountJoinRequest" (
          id, "accountId", "inviteLinkId", name, email, "passwordHash",
          status, "decidedRole", "decidedOrgRole", "decidedById", "decidedAt",
          "decisionNote", "createdAt", "updatedAt"
        ) VALUES (
          $1,$2,$3,$4,$5,$6,
          $7::"JoinRequestStatus",
          $8::"AccountRole",
          $9::"Role",
          $10,$11,$12,$13,$14
        )`,
        [
          jr.id,
          jr.accountId,
          jr.inviteLinkId,
          jr.name,
          jr.email,
          jr.passwordHash,
          jr.status ?? "PENDING",
          jr.decidedRole ? mapAccountRole(String(jr.decidedRole)) : null,
          jr.decidedOrgRole ? mapOrgRole(String(jr.decidedOrgRole)) : null,
          jr.decidedById,
          jr.decidedAt,
          jr.decisionNote,
          jr.createdAt,
          jr.updatedAt,
        ],
      );
    }

    console.log("==> inserindo EmailVerificationToken…");
    for (const t of emailTokens) {
      await dst.query(
        `INSERT INTO "EmailVerificationToken" (
          id, "userId", "tokenHash", "expiresAt", "usedAt", "createdAt"
        ) VALUES ($1,$2,$3,$4,$5,$6)`,
        [t.id, t.userId, t.tokenHash, t.expiresAt, t.usedAt, t.createdAt],
      );
    }

    console.log("==> inserindo EmployeeProfile (jobRoleId=null — JobRoles não migrados)…");
    let profilesOk = 0;
    for (const p of profiles) {
      await dst.query(
        `INSERT INTO "EmployeeProfile" (
          id, "organizationId", "userId", registration, "taxId", phone,
          "jobRoleId", "admittedAt", "dismissedAt", "createdAt", "updatedAt"
        ) VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10)`,
        [
          p.id,
          p.organizationId,
          p.userId,
          p.registration,
          p.taxId,
          p.phone,
          p.admittedAt,
          p.dismissedAt,
          p.createdAt,
          p.updatedAt,
        ],
      );
      profilesOk += 1;
    }

    await dst.query("COMMIT");
    console.log(`==> ok — profiles=${profilesOk}`);
  } catch (err) {
    await dst.query("ROLLBACK");
    throw err;
  } finally {
    await src.end();
    await dst.end();
  }

  // Verificação pós-commit
  const check = new Client({ connectionString: TARGET });
  await check.connect();
  const counts = await check.query(`
    SELECT 'User' t, count(*)::int c FROM "User"
    UNION ALL SELECT 'Organization', count(*)::int FROM "Organization"
    UNION ALL SELECT 'Account', count(*)::int FROM "Account"
    UNION ALL SELECT 'Membership', count(*)::int FROM "Membership"
    UNION ALL SELECT 'AccountMembership', count(*)::int FROM "AccountMembership"
    UNION ALL SELECT 'EmployeeProfile', count(*)::int FROM "EmployeeProfile"
    UNION ALL SELECT 'Membership.MASTER', count(*)::int FROM "Membership" WHERE role = 'MASTER'
  `);
  console.log("==> contagens destino:");
  for (const row of counts.rows) {
    console.log(`    ${row.t}: ${row.c}`);
  }
  const sample = await check.query(
    `SELECT login, name, active FROM "User" ORDER BY "createdAt" LIMIT 8`,
  );
  console.log("==> amostra users:", sample.rows);
  await check.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
