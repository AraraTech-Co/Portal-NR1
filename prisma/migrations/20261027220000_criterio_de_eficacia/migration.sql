-- Critério de eficácia registrado depois da validação: quem e quando. [B3-4-A]
ALTER TABLE "Action" ADD COLUMN IF NOT EXISTS "effectivenessCriteriaLateById" TEXT;
ALTER TABLE "Action" ADD COLUMN IF NOT EXISTS "effectivenessCriteriaLateAt" TIMESTAMP(3);

DO $$
BEGIN
  ALTER TABLE "Action"
    ADD CONSTRAINT "Action_effectivenessCriteriaLateById_fkey"
    FOREIGN KEY ("effectivenessCriteriaLateById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
