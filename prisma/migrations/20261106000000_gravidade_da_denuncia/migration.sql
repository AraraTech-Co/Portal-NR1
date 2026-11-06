-- Gravidade da denúncia. A coluna entra com valor padrão e as denúncias que
-- já existem recebem a gravidade pela categoria: assédio sexual e
-- discriminação são Alta; as outras, Normal. Status, mensagens e datas não
-- mudam. [C1-1]
DO $$ BEGIN
    CREATE TYPE "ReportSeverity" AS ENUM ('HIGH', 'NORMAL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE "ReportSeveritySource" AS ENUM ('AUTO', 'COMMITTEE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "EthicsReport" ADD COLUMN IF NOT EXISTS "severity" "ReportSeverity" NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "EthicsReport" ADD COLUMN IF NOT EXISTS "severitySource" "ReportSeveritySource" NOT NULL DEFAULT 'AUTO';

-- Só as que ainda estão com a gravidade automática: rodar de novo não
-- desfaz ajuste do comitê.
UPDATE "EthicsReport"
   SET "severity" = 'HIGH'
 WHERE "severitySource" = 'AUTO'
   AND "category" IN ('HARASSMENT_SEXUAL', 'DISCRIMINATION')
   AND "severity" <> 'HIGH';

CREATE TABLE IF NOT EXISTS "EthicsReportSeverityChange" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "fromSeverity" "ReportSeverity" NOT NULL,
    "toSeverity" "ReportSeverity" NOT NULL,
    "reason" TEXT NOT NULL,
    "byId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EthicsReportSeverityChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EthicsReportSeverityChange_reportId_at_idx"
    ON "EthicsReportSeverityChange"("reportId", "at");

DO $$ BEGIN
    ALTER TABLE "EthicsReportSeverityChange"
        ADD CONSTRAINT "EthicsReportSeverityChange_reportId_fkey"
        FOREIGN KEY ("reportId") REFERENCES "EthicsReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "EthicsReportSeverityChange"
        ADD CONSTRAINT "EthicsReportSeverityChange_byId_fkey"
        FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
