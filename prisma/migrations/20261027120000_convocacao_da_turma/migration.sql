-- A convocação sabe para qual turma presencial chama, e o convocado vê a
-- turma na página do treinamento. [B3-3-C]
ALTER TABLE "Summon" ADD COLUMN IF NOT EXISTS "trainingSessionId" TEXT;

DO $$
BEGIN
  ALTER TABLE "Summon"
    ADD CONSTRAINT "Summon_trainingSessionId_fkey"
    FOREIGN KEY ("trainingSessionId") REFERENCES "TrainingSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Summon_trainingSessionId_idx" ON "Summon"("trainingSessionId");

-- As convocações de turma criadas antes desta ligação: nasceram na mesma
-- transação da turma, com o mesmo título, data, autor e empresa. Entre turmas
-- que casam, fica a criada mais perto da convocação, até um minuto.
UPDATE "Summon" AS s
SET "trainingSessionId" = (
  SELECT ts."id"
  FROM "TrainingSession" AS ts
  JOIN "Training" AS t ON t."id" = ts."trainingId"
  WHERE ts."organizationId" = s."organizationId"
    AND ts."heldAt" = s."scheduledFor"
    AND ts."recordedById" = s."createdById"
    AND s."title" = 'Treinamento: ' || t."title"
    AND ABS(EXTRACT(EPOCH FROM (ts."createdAt" - s."createdAt"))) < 60
  ORDER BY ABS(EXTRACT(EPOCH FROM (ts."createdAt" - s."createdAt")))
  LIMIT 1
)
WHERE s."trainingSessionId" IS NULL
  AND s."title" LIKE 'Treinamento: %';
