-- Cópia entre filiais. [C3-8]
--
-- Cada item copiado guarda de onde veio (`copiedFromId`, sem chave
-- estrangeira: é procedência, e a origem pode ser arquivada) e quando foi
-- copiado (`copiedAt`). O índice único (pai, copiedFromId) faz o banco
-- recusar a segunda cópia do mesmo item no mesmo lugar, inclusive em duas
-- cópias ao mesmo tempo. Nulos não colidem: o que não foi copiado fica como
-- está.
--
-- A exigência da função ganha `updatedAt`, para saber se o destino mudou
-- depois da cópia; as linhas que já existem recebem a hora da migração.
--
-- Só colunas novas, nulas (ou com valor padrão), uma tabela nova e um tipo
-- de aviso novo. Nada que existe muda.

ALTER TABLE "Sector" ADD COLUMN IF NOT EXISTS "copiedFromId" TEXT;
ALTER TABLE "Sector" ADD COLUMN IF NOT EXISTS "copiedAt" TIMESTAMP(3);
ALTER TABLE "JobRole" ADD COLUMN IF NOT EXISTS "copiedFromId" TEXT;
ALTER TABLE "JobRole" ADD COLUMN IF NOT EXISTS "copiedAt" TIMESTAMP(3);
ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS "copiedFromId" TEXT;
ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS "copiedAt" TIMESTAMP(3);
ALTER TABLE "Hazard" ADD COLUMN IF NOT EXISTS "copiedFromId" TEXT;
ALTER TABLE "Hazard" ADD COLUMN IF NOT EXISTS "copiedAt" TIMESTAMP(3);
ALTER TABLE "Risk" ADD COLUMN IF NOT EXISTS "copiedFromId" TEXT;
ALTER TABLE "Risk" ADD COLUMN IF NOT EXISTS "copiedAt" TIMESTAMP(3);
ALTER TABLE "ControlMeasure" ADD COLUMN IF NOT EXISTS "copiedFromId" TEXT;
ALTER TABLE "ControlMeasure" ADD COLUMN IF NOT EXISTS "copiedAt" TIMESTAMP(3);
ALTER TABLE "RiskAssessment" ADD COLUMN IF NOT EXISTS "copiedFromId" TEXT;
ALTER TABLE "RiskAssessment" ADD COLUMN IF NOT EXISTS "copiedAt" TIMESTAMP(3);
ALTER TABLE "JobRoleRequirement" ADD COLUMN IF NOT EXISTS "copiedFromId" TEXT;
ALTER TABLE "JobRoleRequirement" ADD COLUMN IF NOT EXISTS "copiedAt" TIMESTAMP(3);
ALTER TABLE "JobRoleRequirement" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "Sector_establishmentId_copiedFromId_key" ON "Sector"("establishmentId", "copiedFromId");
CREATE UNIQUE INDEX IF NOT EXISTS "JobRole_sectorId_copiedFromId_key" ON "JobRole"("sectorId", "copiedFromId");
CREATE UNIQUE INDEX IF NOT EXISTS "Activity_sectorId_copiedFromId_key" ON "Activity"("sectorId", "copiedFromId");
CREATE UNIQUE INDEX IF NOT EXISTS "Hazard_activityId_copiedFromId_key" ON "Hazard"("activityId", "copiedFromId");
CREATE UNIQUE INDEX IF NOT EXISTS "Risk_hazardId_copiedFromId_key" ON "Risk"("hazardId", "copiedFromId");
CREATE UNIQUE INDEX IF NOT EXISTS "ControlMeasure_riskId_copiedFromId_key" ON "ControlMeasure"("riskId", "copiedFromId");
CREATE UNIQUE INDEX IF NOT EXISTS "RiskAssessment_riskId_copiedFromId_key" ON "RiskAssessment"("riskId", "copiedFromId");
CREATE UNIQUE INDEX IF NOT EXISTS "JobRoleRequirement_jobRoleId_copiedFromId_key" ON "JobRoleRequirement"("jobRoleId", "copiedFromId");

CREATE TABLE IF NOT EXISTS "EstablishmentCopy" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sourceEstablishmentId" TEXT NOT NULL,
  "targetEstablishmentId" TEXT NOT NULL,
  "copiedById" TEXT NOT NULL,
  "counts" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EstablishmentCopy_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EstablishmentCopy_organizationId_createdAt_idx" ON "EstablishmentCopy"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "EstablishmentCopy_targetEstablishmentId_idx" ON "EstablishmentCopy"("targetEstablishmentId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EstablishmentCopy_organizationId_fkey') THEN
    ALTER TABLE "EstablishmentCopy" ADD CONSTRAINT "EstablishmentCopy_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EstablishmentCopy_sourceEstablishmentId_fkey') THEN
    ALTER TABLE "EstablishmentCopy" ADD CONSTRAINT "EstablishmentCopy_sourceEstablishmentId_fkey"
      FOREIGN KEY ("sourceEstablishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EstablishmentCopy_targetEstablishmentId_fkey') THEN
    ALTER TABLE "EstablishmentCopy" ADD CONSTRAINT "EstablishmentCopy_targetEstablishmentId_fkey"
      FOREIGN KEY ("targetEstablishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EstablishmentCopy_copiedById_fkey') THEN
    ALTER TABLE "EstablishmentCopy" ADD CONSTRAINT "EstablishmentCopy_copiedById_fkey"
      FOREIGN KEY ("copiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'UNIT_COPY_AWAITING_VALIDATION';
