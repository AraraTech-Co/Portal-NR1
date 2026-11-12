-- Dados da planilha da folha e CBO da função. [PF-2]
-- Só acrescenta: colunas nulas na função e uma tabela nova. Idempotente.

ALTER TABLE "JobRole" ADD COLUMN IF NOT EXISTS "cbo2002" TEXT;
ALTER TABLE "JobRole" ADD COLUMN IF NOT EXISTS "cbo94" TEXT;

CREATE TABLE IF NOT EXISTS "EmployeePayrollData" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "rg" TEXT,
    "pis" TEXT,
    "ctpsNumber" TEXT,
    "ctpsSeries" TEXT,
    "ctpsUf" TEXT,
    "salaryType" TEXT,
    "fgtsOptionDate" TIMESTAMP(3),
    "dependents" INTEGER,
    "educationLevel" TEXT,
    "nationalityCode" TEXT,
    "address" TEXT,
    "addressComplement" TEXT,
    "district" TEXT,
    "city" TEXT,
    "terminationDate" TIMESTAMP(3),
    "terminationCause" TEXT,
    "movementType" TEXT,
    "competence" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmployeePayrollData_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EmployeePayrollData_profileId_key" ON "EmployeePayrollData"("profileId");
CREATE INDEX IF NOT EXISTS "EmployeePayrollData_organizationId_idx" ON "EmployeePayrollData"("organizationId");

DO $$ BEGIN
  ALTER TABLE "EmployeePayrollData" ADD CONSTRAINT "EmployeePayrollData_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "EmployeePayrollData" ADD CONSTRAINT "EmployeePayrollData_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
