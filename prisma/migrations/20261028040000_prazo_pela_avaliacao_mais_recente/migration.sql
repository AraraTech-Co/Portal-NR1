-- O nível com que a ação foi aberta, e o aviso de quando a validação o muda.
-- [B3-2-A]
ALTER TABLE "Action" ADD COLUMN IF NOT EXISTS "riskLevelAtOpening" TEXT;
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'ACTION_RISK_LEVEL_CHANGED';
