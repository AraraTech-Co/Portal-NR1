-- Ciência de quem denunciou no encerramento: quando leu e o comentário,
-- opcional. Não grava identidade. As denúncias existentes ficam "sem
-- ciência". [C1-5]
ALTER TABLE "EthicsReport" ADD COLUMN IF NOT EXISTS "reporterAckAt" TIMESTAMP(3);
ALTER TABLE "EthicsReport" ADD COLUMN IF NOT EXISTS "reporterAckComment" TEXT;

-- O aviso a quem relatou identificado de que a denúncia foi encerrada.
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'ETHICS_REPORT_CLOSED';
