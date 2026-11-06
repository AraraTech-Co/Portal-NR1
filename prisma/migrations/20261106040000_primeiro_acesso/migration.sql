-- Primeiro acesso por conferência de dados e limite de tentativas. [C1-7]
--
-- Contas existentes: nada muda em senha, estado ou acesso. Elas ganham o
-- marcador de ativação vazio e ficam com a autoativação DESLIGADA
-- (`firstAccessEligible = false`): o histórico delas não é conhecido, e só
-- uma classificação de Master, Dono ou RH muda isso.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "activatedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "firstAccessEligible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "firstAccessUntil" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ActivationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivationToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ActivationToken_tokenHash_key" ON "ActivationToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "ActivationToken_userId_idx" ON "ActivationToken"("userId");
DO $$ BEGIN
    ALTER TABLE "ActivationToken"
        ADD CONSTRAINT "ActivationToken_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "AuthLockout" (
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AuthLockout_pkey" PRIMARY KEY ("key")
);

DO $$ BEGIN
    CREATE TYPE "AuthAttemptKind" AS ENUM ('LOGIN', 'FIRST_ACCESS');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "AuthAttempt" (
    "id" TEXT NOT NULL,
    "kind" "AuthAttemptKind" NOT NULL,
    "subject" TEXT NOT NULL,
    "userId" TEXT,
    "ip" TEXT,
    "success" BOOLEAN NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AuthAttempt_at_idx" ON "AuthAttempt"("at");
CREATE INDEX IF NOT EXISTS "AuthAttempt_userId_at_idx" ON "AuthAttempt"("userId", "at");
