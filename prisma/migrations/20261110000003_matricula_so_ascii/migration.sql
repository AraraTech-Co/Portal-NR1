-- Matrícula só com ASCII imprimível (U+0021–U+007E). [C3-2]
--
-- Banco e servidor não põem em maiúsculas do mesmo jeito as letras
-- especiais ("ß" vira "SS" no JavaScript e "ẞ" no Postgres), e a chave da
-- matrícula divergiria. A aplicação recusa na tela, na planilha e no
-- convite; esta CHECK recusa qualquer outro caminho. Idempotente.
--
-- Se já houver ficha fora do padrão, a migração para com a lista em vez de
-- alterar a matrícula de alguém. Conferir antes do deploy:
--   SELECT id, "registrationKey" FROM "EmployeeProfile"
--    WHERE "registrationKey" IS NOT NULL AND "registrationKey" !~ '^[!-~]+$';
DO $$
DECLARE
    fora TEXT;
BEGIN
    SELECT string_agg(format('%s/%s', id, "registrationKey"), ', ')
      INTO fora
      FROM "EmployeeProfile"
     WHERE "registrationKey" IS NOT NULL AND "registrationKey" !~ '^[!-~]+$';
    IF fora IS NOT NULL THEN
        RAISE EXCEPTION 'Matrícula fora do padrão ASCII (ficha/matrícula): %', fora;
    END IF;
END $$;

DO $$ BEGIN
    ALTER TABLE "EmployeeProfile"
        ADD CONSTRAINT "EmployeeProfile_registrationKey_ascii"
        CHECK ("registrationKey" IS NULL OR "registrationKey" ~ '^[!-~]+$');
EXCEPTION WHEN duplicate_object THEN null; END $$;
