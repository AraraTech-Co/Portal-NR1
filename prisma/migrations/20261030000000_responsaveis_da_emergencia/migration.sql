-- As pessoas responsáveis pelo procedimento de emergência, ligadas ao
-- cadastro. O texto livre continua para quem é de fora da empresa.
CREATE TABLE IF NOT EXISTS "EmergencyProcedureResponsible" (
    "procedureId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmergencyProcedureResponsible_pkey" PRIMARY KEY ("procedureId", "userId")
);

CREATE INDEX IF NOT EXISTS "EmergencyProcedureResponsible_userId_idx"
    ON "EmergencyProcedureResponsible"("userId");

DO $$ BEGIN
    ALTER TABLE "EmergencyProcedureResponsible"
        ADD CONSTRAINT "EmergencyProcedureResponsible_procedureId_fkey"
        FOREIGN KEY ("procedureId") REFERENCES "EmergencyProcedure"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "EmergencyProcedureResponsible"
        ADD CONSTRAINT "EmergencyProcedureResponsible_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
