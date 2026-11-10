-- Unidade sob responsabilidade e unidade gravada no registro individual. [C2-13]
--
-- Só cria a tabela de vínculo e colunas nulas. Nada é preenchido: vínculo de
-- gestor é atribuído expressamente por Master, Dono ou RH, e os registros
-- anteriores ficam sem unidade (só a gestão central os vê até a
-- classificação). Nenhuma linha existente é alterada.
CREATE TABLE IF NOT EXISTS "ManagedEstablishment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "establishmentId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManagedEstablishment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ManagedEstablishment_membershipId_establishmentId_key" ON "ManagedEstablishment"("membershipId", "establishmentId");
CREATE INDEX IF NOT EXISTS "ManagedEstablishment_organizationId_establishmentId_idx" ON "ManagedEstablishment"("organizationId", "establishmentId");

DO $$ BEGIN
    ALTER TABLE "ManagedEstablishment"
        ADD CONSTRAINT "ManagedEstablishment_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "ManagedEstablishment"
        ADD CONSTRAINT "ManagedEstablishment_membershipId_fkey"
        FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "ManagedEstablishment"
        ADD CONSTRAINT "ManagedEstablishment_establishmentId_fkey"
        FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "ManagedEstablishment"
        ADD CONSTRAINT "ManagedEstablishment_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "Payslip" ADD COLUMN IF NOT EXISTS "establishmentId" TEXT;
CREATE INDEX IF NOT EXISTS "Payslip_organizationId_establishmentId_idx" ON "Payslip"("organizationId", "establishmentId");
DO $$ BEGIN
    ALTER TABLE "Payslip"
        ADD CONSTRAINT "Payslip_establishmentId_fkey"
        FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "LeaveRequest" ADD COLUMN IF NOT EXISTS "establishmentId" TEXT;
CREATE INDEX IF NOT EXISTS "LeaveRequest_organizationId_establishmentId_idx" ON "LeaveRequest"("organizationId", "establishmentId");
DO $$ BEGIN
    ALTER TABLE "LeaveRequest"
        ADD CONSTRAINT "LeaveRequest_establishmentId_fkey"
        FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "TimeEntry" ADD COLUMN IF NOT EXISTS "establishmentId" TEXT;
CREATE INDEX IF NOT EXISTS "TimeEntry_organizationId_establishmentId_idx" ON "TimeEntry"("organizationId", "establishmentId");
DO $$ BEGIN
    ALTER TABLE "TimeEntry"
        ADD CONSTRAINT "TimeEntry_establishmentId_fkey"
        FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "MedicalCertificate" ADD COLUMN IF NOT EXISTS "establishmentId" TEXT;
CREATE INDEX IF NOT EXISTS "MedicalCertificate_organizationId_establishmentId_idx" ON "MedicalCertificate"("organizationId", "establishmentId");
DO $$ BEGIN
    ALTER TABLE "MedicalCertificate"
        ADD CONSTRAINT "MedicalCertificate_establishmentId_fkey"
        FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "HrDocument" ADD COLUMN IF NOT EXISTS "establishmentId" TEXT;
CREATE INDEX IF NOT EXISTS "HrDocument_organizationId_establishmentId_idx" ON "HrDocument"("organizationId", "establishmentId");
DO $$ BEGIN
    ALTER TABLE "HrDocument"
        ADD CONSTRAINT "HrDocument_establishmentId_fkey"
        FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "WorkerCertificate" ADD COLUMN IF NOT EXISTS "establishmentId" TEXT;
CREATE INDEX IF NOT EXISTS "WorkerCertificate_organizationId_establishmentId_idx" ON "WorkerCertificate"("organizationId", "establishmentId");
DO $$ BEGIN
    ALTER TABLE "WorkerCertificate"
        ADD CONSTRAINT "WorkerCertificate_establishmentId_fkey"
        FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "OccupationalExam" ADD COLUMN IF NOT EXISTS "establishmentId" TEXT;
CREATE INDEX IF NOT EXISTS "OccupationalExam_organizationId_establishmentId_idx" ON "OccupationalExam"("organizationId", "establishmentId");
DO $$ BEGIN
    ALTER TABLE "OccupationalExam"
        ADD CONSTRAINT "OccupationalExam_establishmentId_fkey"
        FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
