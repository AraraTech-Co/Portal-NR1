-- Feriados da empresa e da filial no prazo da denúncia. [C4-11]
-- Só acrescenta. Idempotente.

ALTER TABLE "Establishment" ADD COLUMN IF NOT EXISTS "goodFridayHoliday" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Establishment" ADD COLUMN IF NOT EXISTS "corpusChristiHoliday" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "Holiday" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "establishmentId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Holiday_organizationId_establishmentId_idx" ON "Holiday"("organizationId", "establishmentId");

DO $$ BEGIN
  ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_establishmentId_fkey"
    FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
