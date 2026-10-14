-- Quem é empregado e quem é de empresa contratada (NR-1 1.5.8). [S1-G]
CREATE TYPE "WorkerBond" AS ENUM ('EMPLOYEE', 'CONTRACTOR', 'TEMPORARY', 'APPRENTICE', 'INTERN');

ALTER TABLE "EmployeeProfile" ADD COLUMN "bond" "WorkerBond" NOT NULL DEFAULT 'EMPLOYEE';
ALTER TABLE "EmployeeProfile" ADD COLUMN "contractorId" TEXT;

CREATE INDEX "EmployeeProfile_contractorId_idx" ON "EmployeeProfile"("contractorId");

ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
