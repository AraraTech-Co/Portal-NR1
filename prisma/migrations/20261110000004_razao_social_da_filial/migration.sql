-- Razão social e código da folha da filial; o retrato de quem emitiu no PGR e na ordem de serviço. [C3-4]
--
-- Só colunas novas, todas nulas: nada existente muda. Documento emitido antes
-- fica sem o retrato e continua mostrando a empresa, como hoje.

ALTER TABLE "Establishment" ADD COLUMN IF NOT EXISTS "legalName" TEXT;
ALTER TABLE "Establishment" ADD COLUMN IF NOT EXISTS "payrollCode" TEXT;

ALTER TABLE "PgrDocument" ADD COLUMN IF NOT EXISTS "employerName" TEXT;
ALTER TABLE "PgrDocument" ADD COLUMN IF NOT EXISTS "employerTaxId" TEXT;

ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "employerName" TEXT;
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "employerTaxId" TEXT;
