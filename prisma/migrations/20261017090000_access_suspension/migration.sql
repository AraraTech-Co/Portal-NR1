-- Desligamento, suspensão e prazo vencido deixam de ser a mesma coisa. [CB-39] [CB-44]
CREATE TYPE "AccessSuspensionReason" AS ENUM ('DISMISSAL', 'MANUAL');

ALTER TABLE "Membership" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "Membership" ADD COLUMN "suspensionReason" "AccessSuspensionReason";
ALTER TABLE "Membership" ADD COLUMN "suspendedById" TEXT;

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_suspendedById_fkey" FOREIGN KEY ("suspendedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Membership_organizationId_suspendedAt_idx" ON "Membership"("organizationId", "suspendedAt");

-- Quem já estava desligado continuava entrando: o corte de acesso só valia
-- para desligamentos registrados depois da atualização. [CB-9]
UPDATE "Membership" m
SET "suspendedAt" = p."dismissedAt",
    "suspensionReason" = 'DISMISSAL',
    "suspendedById" = p."dismissedById"
FROM "EmployeeProfile" p
WHERE p."userId" = m."userId"
  AND p."organizationId" = m."organizationId"
  AND p."dismissedAt" IS NOT NULL
  AND m."suspendedAt" IS NULL;

-- O desligamento gravava o corte no prazo do fiscal; agora tem campo próprio.
UPDATE "Membership" m
SET "accessExpiresAt" = NULL
FROM "EmployeeProfile" p
WHERE p."userId" = m."userId"
  AND p."organizationId" = m."organizationId"
  AND p."dismissedAt" IS NOT NULL
  AND m."role" <> 'FISCAL'
  AND m."accessExpiresAt" IS NOT NULL;
