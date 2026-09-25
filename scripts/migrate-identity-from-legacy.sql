-- Migração identidade nr1_db → portal_nr1 (modelo Express).
-- Roda como postgres dentro de sgc-postgres-primary.
-- OrgRole legado → Role; DEVELOPER → USER; Organization.active=true.
-- EmployeeProfile.jobRoleId fica NULL (JobRoles não vêm nesta leva).

\set ON_ERROR_STOP on

SELECT dblink_connect(
  'legacy',
  'dbname=nr1_db'
);

BEGIN;

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
CASCADE;

INSERT INTO "Organization" (
  id, name, "taxId", active,
  "assessmentReviewMonths", "hasSstCertification",
  "responsibleName", "responsibleRole", "responsibleRegistration",
  "createdAt", "updatedAt"
)
SELECT
  id, name, "taxId", true,
  "assessmentReviewMonths", "hasSstCertification",
  "responsibleName", "responsibleRole", "responsibleRegistration",
  "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT id, name, "taxId",
         "assessmentReviewMonths", "hasSstCertification",
         "responsibleName", "responsibleRole", "responsibleRegistration",
         "createdAt", "updatedAt"
  FROM "Organization"
$q$) AS t(
  id text, name text, "taxId" text,
  "assessmentReviewMonths" int, "hasSstCertification" boolean,
  "responsibleName" text, "responsibleRole" text, "responsibleRegistration" text,
  "createdAt" timestamp, "updatedAt" timestamp
);

INSERT INTO "Account" (id, "organizationId", name, active, "createdAt", "updatedAt")
SELECT id, "organizationId", name, active, "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT id, "organizationId", name, active, "createdAt", "updatedAt" FROM "Account"
$q$) AS t(
  id text, "organizationId" text, name text, active boolean,
  "createdAt" timestamp, "updatedAt" timestamp
);

INSERT INTO "User" (
  id, login, email, name, "passwordHash", active,
  "emailVerifiedAt", "mustChangePassword", "createdAt", "updatedAt"
)
SELECT
  id, login, email, name, "passwordHash", active,
  "emailVerifiedAt", "mustChangePassword", "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT id, login, email, name, "passwordHash", active,
         "emailVerifiedAt", "mustChangePassword", "createdAt", "updatedAt"
  FROM "User"
$q$) AS t(
  id text, login text, email text, name text, "passwordHash" text, active boolean,
  "emailVerifiedAt" timestamp, "mustChangePassword" boolean,
  "createdAt" timestamp, "updatedAt" timestamp
);

INSERT INTO "Membership" (
  id, "userId", "organizationId", role, "createdAt", "updatedAt"
)
SELECT
  id, "userId", "organizationId",
  CASE role
    WHEN 'MASTER' THEN 'MASTER'::"Role"
    WHEN 'SST' THEN 'SST'::"Role"
    WHEN 'RH' THEN 'RH'::"Role"
    WHEN 'ADMINISTRADOR_GERAL' THEN 'ADMIN'::"Role"
    WHEN 'GERENTE_ADMINISTRATIVO' THEN 'ADMIN'::"Role"
    WHEN 'GERENTE_LOJA' THEN 'ADMIN'::"Role"
    ELSE 'COLABORADOR'::"Role"
  END,
  "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT id, "userId", "organizationId", role::text, "createdAt", "updatedAt"
  FROM "Membership"
$q$) AS t(
  id text, "userId" text, "organizationId" text, role text,
  "createdAt" timestamp, "updatedAt" timestamp
);

INSERT INTO "AccountMembership" (
  id, "accountId", "userId", role, "createdAt", "updatedAt"
)
SELECT
  id, "accountId", "userId",
  CASE role
    WHEN 'OWNER' THEN 'OWNER'::"AccountRole"
    WHEN 'ADMIN' THEN 'ADMIN'::"AccountRole"
    ELSE 'USER'::"AccountRole"
  END,
  "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT id, "accountId", "userId", role::text, "createdAt", "updatedAt"
  FROM "AccountMembership"
$q$) AS t(
  id text, "accountId" text, "userId" text, role text,
  "createdAt" timestamp, "updatedAt" timestamp
);

INSERT INTO "AccountInviteLink" (
  id, "accountId", token, "roleMode", role, "orgRole",
  label, active, "expiresAt", "maxUses", "usedCount",
  "createdById", "createdAt", "updatedAt"
)
SELECT
  id, "accountId", token,
  "roleMode"::"InviteRoleMode",
  CASE role WHEN 'OWNER' THEN 'OWNER'::"AccountRole"
            WHEN 'ADMIN' THEN 'ADMIN'::"AccountRole"
            ELSE 'USER'::"AccountRole" END,
  CASE "orgRole"
    WHEN 'MASTER' THEN 'MASTER'::"Role"
    WHEN 'SST' THEN 'SST'::"Role"
    WHEN 'RH' THEN 'RH'::"Role"
    WHEN 'ADMINISTRADOR_GERAL' THEN 'ADMIN'::"Role"
    WHEN 'GERENTE_ADMINISTRATIVO' THEN 'ADMIN'::"Role"
    WHEN 'GERENTE_LOJA' THEN 'ADMIN'::"Role"
    ELSE 'COLABORADOR'::"Role"
  END,
  label, active, "expiresAt", "maxUses", "usedCount",
  "createdById", "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT id, "accountId", token, "roleMode"::text, role::text, "orgRole"::text,
         label, active, "expiresAt", "maxUses", "usedCount",
         "createdById", "createdAt", "updatedAt"
  FROM "AccountInviteLink"
$q$) AS t(
  id text, "accountId" text, token text, "roleMode" text, role text, "orgRole" text,
  label text, active boolean, "expiresAt" timestamp, "maxUses" int, "usedCount" int,
  "createdById" text, "createdAt" timestamp, "updatedAt" timestamp
);

INSERT INTO "AccountJoinRequest" (
  id, "accountId", "inviteLinkId", name, email, "passwordHash",
  status, "decidedRole", "decidedOrgRole", "decidedById", "decidedAt",
  "decisionNote", "createdAt", "updatedAt"
)
SELECT
  id, "accountId", "inviteLinkId", name, email, "passwordHash",
  status::"JoinRequestStatus",
  CASE "decidedRole"
    WHEN 'OWNER' THEN 'OWNER'::"AccountRole"
    WHEN 'ADMIN' THEN 'ADMIN'::"AccountRole"
    WHEN 'USER' THEN 'USER'::"AccountRole"
    WHEN 'DEVELOPER' THEN 'USER'::"AccountRole"
    ELSE NULL
  END,
  CASE "decidedOrgRole"
    WHEN 'MASTER' THEN 'MASTER'::"Role"
    WHEN 'SST' THEN 'SST'::"Role"
    WHEN 'RH' THEN 'RH'::"Role"
    WHEN 'ADMINISTRADOR_GERAL' THEN 'ADMIN'::"Role"
    WHEN 'GERENTE_ADMINISTRATIVO' THEN 'ADMIN'::"Role"
    WHEN 'GERENTE_LOJA' THEN 'ADMIN'::"Role"
    WHEN 'COLABORADOR' THEN 'COLABORADOR'::"Role"
    WHEN 'AUDITOR' THEN 'COLABORADOR'::"Role"
    ELSE NULL
  END,
  "decidedById", "decidedAt", "decisionNote", "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT id, "accountId", "inviteLinkId", name, email, "passwordHash",
         status::text, "decidedRole"::text, "decidedOrgRole"::text,
         "decidedById", "decidedAt", "decisionNote", "createdAt", "updatedAt"
  FROM "AccountJoinRequest"
$q$) AS t(
  id text, "accountId" text, "inviteLinkId" text, name text, email text, "passwordHash" text,
  status text, "decidedRole" text, "decidedOrgRole" text,
  "decidedById" text, "decidedAt" timestamp, "decisionNote" text,
  "createdAt" timestamp, "updatedAt" timestamp
);

INSERT INTO "EmailVerificationToken" (
  id, "userId", "tokenHash", "expiresAt", "usedAt", "createdAt"
)
SELECT id, "userId", "tokenHash", "expiresAt", "usedAt", "createdAt"
FROM dblink('legacy', $q$
  SELECT id, "userId", "tokenHash", "expiresAt", "usedAt", "createdAt"
  FROM "EmailVerificationToken"
$q$) AS t(
  id text, "userId" text, "tokenHash" text,
  "expiresAt" timestamp, "usedAt" timestamp, "createdAt" timestamp
);

INSERT INTO "EmployeeProfile" (
  id, "organizationId", "userId", registration, "taxId", phone,
  "jobRoleId", "admittedAt", "dismissedAt", "createdAt", "updatedAt"
)
SELECT
  id, "organizationId", "userId", registration, "taxId", phone,
  NULL, "admittedAt", "dismissedAt", "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT id, "organizationId", "userId", registration, "taxId", phone,
         "admittedAt", "dismissedAt", "createdAt", "updatedAt"
  FROM "EmployeeProfile"
$q$) AS t(
  id text, "organizationId" text, "userId" text, registration text, "taxId" text, phone text,
  "admittedAt" timestamp, "dismissedAt" timestamp,
  "createdAt" timestamp, "updatedAt" timestamp
);

COMMIT;

SELECT dblink_disconnect('legacy');

SELECT 'User' AS t, count(*)::int AS c FROM "User"
UNION ALL SELECT 'Organization', count(*)::int FROM "Organization"
UNION ALL SELECT 'Account', count(*)::int FROM "Account"
UNION ALL SELECT 'Membership', count(*)::int FROM "Membership"
UNION ALL SELECT 'AccountMembership', count(*)::int FROM "AccountMembership"
UNION ALL SELECT 'EmployeeProfile', count(*)::int FROM "EmployeeProfile"
UNION ALL SELECT 'Membership MASTER', count(*)::int FROM "Membership" WHERE role = 'MASTER';
