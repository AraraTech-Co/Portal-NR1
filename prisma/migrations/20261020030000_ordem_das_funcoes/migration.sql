-- A função nascia no fim da lista e lá ficava: a ordem era a de criação, e
-- não havia como aproximar as parecidas. [S1-I]
ALTER TABLE "JobRole" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

-- Começa com a ordem que as telas já mostravam, uma sequência por setor.
WITH ordenadas AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (PARTITION BY "sectorId" ORDER BY "createdAt" ASC, "id" ASC) - 1 AS pos
  FROM "JobRole"
)
UPDATE "JobRole" AS j
SET "position" = o.pos
FROM ordenadas AS o
WHERE j."id" = o."id";

CREATE INDEX "JobRole_sectorId_position_idx" ON "JobRole"("sectorId", "position");
