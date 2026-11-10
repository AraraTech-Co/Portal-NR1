-- Matrícula única por filial, comparada pela chave. [C3-2]
--
-- Etapa 2 de 2, depois do preenchimento. A mesma matrícula passa a existir
-- em filiais diferentes (CNPJs do mesmo grupo, pessoas diferentes).
--
-- Se já houver, na MESMA filial, duas matrículas que só diferem por zeros à
-- esquerda ou maiúsculas ("74" e "074"), a migração para com a lista em vez
-- de escolher uma. Conferir antes do deploy:
--   SELECT "establishmentId", "registrationKey", count(*)
--     FROM "EmployeeProfile"
--    WHERE "establishmentId" IS NOT NULL AND "registrationKey" IS NOT NULL
--    GROUP BY 1, 2 HAVING count(*) > 1;
DO $$
DECLARE
    repetidas TEXT;
BEGIN
    SELECT string_agg(format('%s/%s', "establishmentId", "registrationKey"), ', ')
      INTO repetidas
      FROM (
        SELECT "establishmentId", "registrationKey"
          FROM "EmployeeProfile"
         WHERE "establishmentId" IS NOT NULL AND "registrationKey" IS NOT NULL
         GROUP BY 1, 2 HAVING count(*) > 1
      ) r;
    IF repetidas IS NOT NULL THEN
        RAISE EXCEPTION 'Matrícula repetida na mesma filial (filial/matrícula): %', repetidas;
    END IF;
END $$;

DROP INDEX IF EXISTS "EmployeeProfile_organizationId_registration_key";
CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeProfile_establishmentId_registrationKey_key"
    ON "EmployeeProfile"("establishmentId", "registrationKey");
