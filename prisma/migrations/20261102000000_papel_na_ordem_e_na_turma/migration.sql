-- O papel assinado da ordem de serviço e da turma presencial (decisão
-- B3-4-F): a evidência passa a poder pender de uma ordem de serviço ou de
-- uma turma. Só acrescenta colunas nulas; nada existente muda. [CB-74]
ALTER TABLE "Evidence" ADD COLUMN IF NOT EXISTS "serviceOrderId" TEXT;
ALTER TABLE "Evidence" ADD COLUMN IF NOT EXISTS "trainingSessionId" TEXT;

CREATE INDEX IF NOT EXISTS "Evidence_serviceOrderId_idx" ON "Evidence"("serviceOrderId");
CREATE INDEX IF NOT EXISTS "Evidence_trainingSessionId_idx" ON "Evidence"("trainingSessionId");

DO $$ BEGIN
    ALTER TABLE "Evidence"
        ADD CONSTRAINT "Evidence_serviceOrderId_fkey"
        FOREIGN KEY ("serviceOrderId") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "Evidence"
        ADD CONSTRAINT "Evidence_trainingSessionId_fkey"
        FOREIGN KEY ("trainingSessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
