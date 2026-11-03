-- O tipo do holerite: adiantamento e folha mensal do mesmo mês deixam de
-- ocupar o mesmo lugar. Os já publicados ficam como folha mensal. Nada é
-- apagado: a coluna entra com valor padrão e só o índice único muda. [B4-G]
DO $$ BEGIN
    CREATE TYPE "PayslipKind" AS ENUM ('MONTHLY', 'ADVANCE', 'VACATION', 'THIRTEENTH', 'TERMINATION');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "Payslip" ADD COLUMN IF NOT EXISTS "kind" "PayslipKind" NOT NULL DEFAULT 'MONTHLY';

-- O nome é o que o Prisma dá: o do índice passa de 63 caracteres e é cortado.
CREATE UNIQUE INDEX IF NOT EXISTS "Payslip_organizationId_userId_referenceYear_referenceMonth__key"
    ON "Payslip"("organizationId", "userId", "referenceYear", "referenceMonth", "kind");

DROP INDEX IF EXISTS "Payslip_organizationId_userId_referenceYear_referenceMonth_key";
