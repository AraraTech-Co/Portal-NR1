-- Apelido do cargo da folha: "juntar o cargo X com a função Y" fica guardado
-- por filial, para a próxima planilha casar sozinha. [C6-4]
-- Só acrescenta. Idempotente.

CREATE TABLE IF NOT EXISTS "JobRoleAlias" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "establishmentId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "jobRoleId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobRoleAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "JobRoleAlias_establishmentId_chave_key" ON "JobRoleAlias"("establishmentId", "chave");
CREATE INDEX IF NOT EXISTS "JobRoleAlias_jobRoleId_idx" ON "JobRoleAlias"("jobRoleId");

DO $$ BEGIN
  ALTER TABLE "JobRoleAlias" ADD CONSTRAINT "JobRoleAlias_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "JobRoleAlias" ADD CONSTRAINT "JobRoleAlias_establishmentId_fkey"
    FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "JobRoleAlias" ADD CONSTRAINT "JobRoleAlias_jobRoleId_fkey"
    FOREIGN KEY ("jobRoleId") REFERENCES "JobRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
