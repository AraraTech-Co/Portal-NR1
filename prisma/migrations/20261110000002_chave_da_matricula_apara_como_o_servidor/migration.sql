-- A chave da matrícula apara as pontas como o servidor. [C3-2]
--
-- O `\s` do Postgres não pega o espaço duro (NBSP, U+00A0), que é o que vem
-- quando se cola do Excel; o `String.prototype.trim` do servidor pega. Com
-- conjuntos diferentes, " 074" (com NBSP) teria outra chave que "74": o
-- login não acharia a pessoa e a unicidade da filial deixaria passar os dois.
--
-- O conjunto abaixo é o do `trim` do JavaScript: tab, LF, VT, FF, CR,
-- espaço, NBSP, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F,
-- U+3000 e U+FEFF. Idempotente.

CREATE OR REPLACE FUNCTION nr1_trim_like_js(raw TEXT) RETURNS TEXT
    LANGUAGE sql IMMUTABLE AS $$
    SELECT regexp_replace(
        raw,
        '^[\u0009-\u000D    -     　﻿]+|[\u0009-\u000D    -     　﻿]+$',
        '',
        'g'
    )
$$;

CREATE OR REPLACE FUNCTION nr1_registration_key(raw TEXT) RETURNS TEXT
    LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN raw IS NULL THEN NULL
        WHEN nr1_trim_like_js(raw) = '' THEN NULL
        WHEN nr1_trim_like_js(raw) ~ '^[0-9]+$'
            THEN regexp_replace(nr1_trim_like_js(raw), '^0+([0-9])', '\1')
        ELSE upper(nr1_trim_like_js(raw))
    END
$$;

-- Recalcula as chaves já gravadas pelo gatilho.
UPDATE "EmployeeProfile" SET "registration" = "registration" WHERE "registration" IS NOT NULL;
