-- Prazo da primeira providência da denúncia. [C1-2]
--
-- `dueAt` fica nulo nas denúncias que já existem: o servidor calcula o
-- vencimento delas pelo `createdAt`, com o mesmo cálculo de dias úteis das
-- novas. `createdAt` não muda.
--
-- `firstActionAt` das que já existem é a menor data entre a primeira
-- mensagem do comitê e a primeira mudança de situação para fora de
-- "Recebido" registrada na trilha. Sem nenhuma das duas, fica nulo: a
-- denúncia que já saiu de "Recebido" aparece como "não apurada", sem
-- inventar cumprimento nem atraso.
ALTER TABLE "EthicsReport" ADD COLUMN IF NOT EXISTS "dueAt" TIMESTAMP(3);
ALTER TABLE "EthicsReport" ADD COLUMN IF NOT EXISTS "firstActionAt" TIMESTAMP(3);

UPDATE "EthicsReport" r
   SET "firstActionAt" = LEAST(
         (SELECT MIN(m."createdAt")
            FROM "EthicsReportMessage" m
           WHERE m."reportId" = r."id"
             AND m."side" = 'COMMITTEE'),
         (SELECT MIN(a."createdAt")
            FROM "AuditEvent" a
           WHERE a."entityType" = 'EthicsReport'
             AND a."entityId" = r."id"
             AND a."organizationId" = r."organizationId"
             AND a."action" = 'ethics_report.update_status'
             AND a."after" ->> 'status' IS NOT NULL
             AND a."after" ->> 'status' <> 'RECEIVED')
       )
 WHERE r."firstActionAt" IS NULL;
