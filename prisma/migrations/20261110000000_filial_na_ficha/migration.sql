-- Filial na ficha e chave da matrícula. [C3-2]
--
-- Etapa 1 de 2: só acrescenta e preenche; a unicidade nova vem na migração
-- seguinte, depois do preenchimento. Idempotente.
--
-- Um gatilho grava as duas colunas em TODA escrita da ficha — tela,
-- importação, convite, scripts e testes —, para nenhum caminho esquecer:
-- - "registrationKey": a matrícula sem espaços nas pontas, em maiúsculas e,
--   se for só dígitos, sem zeros à esquerda (a mesma regra de
--   canonicalRegistration no servidor);
-- - "establishmentId": com função, a unidade do setor da função (a ficha e a
--   função nunca divergem); sem função, fica o que a aplicação gravou.

ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "establishmentId" TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "registrationKey" TEXT;

CREATE INDEX IF NOT EXISTS "EmployeeProfile_establishmentId_idx" ON "EmployeeProfile"("establishmentId");

DO $$ BEGIN
    ALTER TABLE "EmployeeProfile"
        ADD CONSTRAINT "EmployeeProfile_establishmentId_fkey"
        FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE OR REPLACE FUNCTION nr1_registration_key(raw TEXT) RETURNS TEXT
    LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN raw IS NULL THEN NULL
        WHEN regexp_replace(raw, '^\s+|\s+$', '', 'g') = '' THEN NULL
        WHEN regexp_replace(raw, '^\s+|\s+$', '', 'g') ~ '^[0-9]+$'
            THEN regexp_replace(regexp_replace(raw, '^\s+|\s+$', '', 'g'), '^0+([0-9])', '\1')
        ELSE upper(regexp_replace(raw, '^\s+|\s+$', '', 'g'))
    END
$$;

CREATE OR REPLACE FUNCTION nr1_employee_profile_derive() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    NEW."registrationKey" := nr1_registration_key(NEW."registration");
    IF NEW."jobRoleId" IS NOT NULL THEN
        SELECT s."establishmentId" INTO NEW."establishmentId"
          FROM "JobRole" j JOIN "Sector" s ON s."id" = j."sectorId"
         WHERE j."id" = NEW."jobRoleId";
    END IF;
    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "EmployeeProfile_derive" ON "EmployeeProfile";
CREATE TRIGGER "EmployeeProfile_derive"
    BEFORE INSERT OR UPDATE ON "EmployeeProfile"
    FOR EACH ROW EXECUTE FUNCTION nr1_employee_profile_derive();

-- Preenche as fichas existentes pelo próprio gatilho. Ficha sem função fica
-- sem filial e aparece para o RH completar.
UPDATE "EmployeeProfile" SET "registration" = "registration";
