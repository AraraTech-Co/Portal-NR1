-- O banco de horas guardava um lançamento por pessoa e por dia: lançar de novo
-- no mesmo dia substituía as horas e o motivo do anterior, sem aviso e sem
-- guardar o que havia. A decisão S5-M fala em cada movimento com histórico, e
-- saldo sem autor não prova nada numa reclamação trabalhista. [CB-66]
ALTER TABLE "TimeEntry" DROP CONSTRAINT IF EXISTS "TimeEntry_organizationId_userId_day_key";
DROP INDEX IF EXISTS "TimeEntry_organizationId_userId_day_key";

ALTER TABLE "TimeEntry" ADD COLUMN "createdById" TEXT;

ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
