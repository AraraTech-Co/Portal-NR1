-- O comitê de ética passa a ser quem a empresa designa. [CB-27]
--
-- Antes, comitê era "todo mundo com leitura no módulo comite" — na prática,
-- o RH inteiro: uma denúncia contra alguém do RH ia parar na mesa dele.
--
-- Enquanto a empresa não designar ninguém, vale a regra antiga: ligar a
-- funcionalidade não pode trancar a empresa fora das próprias denúncias.
CREATE TABLE "EthicsCommitteeMember" (
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "addedById"      TEXT NOT NULL,
  "addedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EthicsCommitteeMember_pkey" PRIMARY KEY ("organizationId", "userId")
);

ALTER TABLE "EthicsCommitteeMember" ADD CONSTRAINT "EthicsCommitteeMember_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EthicsCommitteeMember" ADD CONSTRAINT "EthicsCommitteeMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EthicsCommitteeMember" ADD CONSTRAINT "EthicsCommitteeMember_addedById_fkey"
  FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Quem a denúncia envolve. Quem é citado perde o acesso ao caso: não o vê na
-- lista, não o abre e não responde. [CB-27]
CREATE TABLE "EthicsReportCited" (
  "reportId"   TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "markedById" TEXT NOT NULL,
  "markedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EthicsReportCited_pkey" PRIMARY KEY ("reportId", "userId")
);

CREATE INDEX "EthicsReportCited_userId_idx" ON "EthicsReportCited"("userId");

ALTER TABLE "EthicsReportCited" ADD CONSTRAINT "EthicsReportCited_reportId_fkey"
  FOREIGN KEY ("reportId") REFERENCES "EthicsReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EthicsReportCited" ADD CONSTRAINT "EthicsReportCited_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EthicsReportCited" ADD CONSTRAINT "EthicsReportCited_markedById_fkey"
  FOREIGN KEY ("markedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
