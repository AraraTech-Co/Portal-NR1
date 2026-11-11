-- A ação aberta pelo achado do simulado guarda o simulado e a unidade dele. [C3-6]
--
-- Só colunas novas e nulas: a ação que já existe continua sem unidade, com a
-- central, como hoje. Simulado ou unidade apagados não apagam a ação.

ALTER TABLE "Action" ADD COLUMN IF NOT EXISTS "establishmentId" TEXT;
ALTER TABLE "Action" ADD COLUMN IF NOT EXISTS "drillId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Action_establishmentId_fkey') THEN
    ALTER TABLE "Action" ADD CONSTRAINT "Action_establishmentId_fkey"
      FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Action_drillId_fkey') THEN
    ALTER TABLE "Action" ADD CONSTRAINT "Action_drillId_fkey"
      FOREIGN KEY ("drillId") REFERENCES "EmergencyDrill"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Action_organizationId_establishmentId_idx" ON "Action"("organizationId", "establishmentId");
