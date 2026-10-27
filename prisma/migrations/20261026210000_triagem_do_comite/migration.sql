-- A denúncia que diz envolver alguém do comitê fica com o dono e o master
-- até a triagem. [B3-3-H]
ALTER TABLE "EthicsReport" ADD COLUMN IF NOT EXISTS "committeeInvolved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EthicsReport" ADD COLUMN IF NOT EXISTS "triagedAt" TIMESTAMP(3);
ALTER TABLE "EthicsReport" ADD COLUMN IF NOT EXISTS "triagedById" TEXT;

DO $$
BEGIN
  ALTER TABLE "EthicsReport"
    ADD CONSTRAINT "EthicsReport_triagedById_fkey"
    FOREIGN KEY ("triagedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
