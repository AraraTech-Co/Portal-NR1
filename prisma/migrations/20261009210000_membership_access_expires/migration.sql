-- Fim do acesso à organização (prazo do fiscal). [S7-A]
ALTER TABLE "Membership" ADD COLUMN "accessExpiresAt" TIMESTAMP(3);
