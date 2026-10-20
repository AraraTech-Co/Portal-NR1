-- A categoria do treinamento aparece na tela como está escrita no banco, e o
-- padrão era "GERAL" — lido como código pelo testador. [B2-1-C]
ALTER TABLE "Training" ALTER COLUMN "category" SET DEFAULT 'Geral';

-- Só o valor que o próprio sistema escreveu; categoria digitada fica como está.
UPDATE "Training" SET "category" = 'Geral' WHERE "category" = 'GERAL';
