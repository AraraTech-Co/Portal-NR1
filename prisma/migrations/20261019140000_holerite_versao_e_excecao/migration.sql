-- A versão que o trabalhador viu para de ser apagada. [S5-F]
--
-- Publicar o mesmo mês de novo substituía o holerite e apagava o arquivo
-- anterior do disco. A pessoa que tinha aberto a versão de antes ficava sem
-- o que viu, e a empresa, sem a prova do que entregou.
CREATE TABLE "PayslipVersion" (
  "id"            TEXT NOT NULL,
  "payslipId"     TEXT NOT NULL,
  "storagePath"   TEXT NOT NULL,
  "fileName"      TEXT NOT NULL,
  "publishedById" TEXT NOT NULL,
  "publishedAt"   TIMESTAMP(3) NOT NULL,
  "viewedAt"      TIMESTAMP(3),
  "replacedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "replacedById"  TEXT NOT NULL,
  CONSTRAINT "PayslipVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PayslipVersion_payslipId_replacedAt_idx"
  ON "PayslipVersion"("payslipId", "replacedAt");

ALTER TABLE "PayslipVersion" ADD CONSTRAINT "PayslipVersion_payslipId_fkey"
  FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayslipVersion" ADD CONSTRAINT "PayslipVersion_publishedById_fkey"
  FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayslipVersion" ADD CONSTRAINT "PayslipVersion_replacedById_fkey"
  FOREIGN KEY ("replacedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Publicar fora do padrão da conferência, com motivo e autor. [CB-28]
--
-- A conferência pegou um erro real e não pode cair. Mas um holerite correto
-- de outra contabilidade, ou digitalizado, travava o RH para sempre. Agora
-- dá para publicar assim mesmo dizendo por quê, e isso fica registrado.
ALTER TABLE "Payslip" ADD COLUMN "overrideReason" TEXT;
ALTER TABLE "Payslip" ADD COLUMN "overriddenById" TEXT;
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_overriddenById_fkey"
  FOREIGN KEY ("overriddenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
