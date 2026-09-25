-- Matrícula ou "Externo" no pedido de entrada via convite.
ALTER TABLE "AccountJoinRequest" ADD COLUMN IF NOT EXISTS "registration" TEXT;
ALTER TABLE "AccountJoinRequest" ADD COLUMN IF NOT EXISTS "isExternal" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "AccountJoinRequest_accountId_registration_idx"
  ON "AccountJoinRequest"("accountId", "registration");
