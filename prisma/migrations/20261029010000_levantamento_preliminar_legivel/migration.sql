-- O levantamento preliminar gravava no perigo e na ação o identificador
-- interno do levantamento e do item, e a situação em inglês; saía assim no
-- inventário assinado. Passa ao texto que o servidor grava agora: o dia do
-- levantamento (meia-noite UTC é dia de calendário; com hora, o dia em
-- Brasília) e o que foi decidido. Idempotente: depois de reescrito, nada
-- casa mais. [B2-1-C]

-- A origem do perigo, com o dia do levantamento e o que foi decidido.
UPDATE "Hazard" h
SET "source" =
  'Levantamento preliminar de ' ||
  CASE
    WHEN s."conductedAt"::time = '00:00:00' THEN to_char(s."conductedAt", 'DD/MM/YYYY')
    ELSE to_char((s."conductedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')
  END ||
  CASE
    WHEN h."monitoringData" LIKE 'Preliminar · deferred · item %' THEN ', sem medida imediata'
    WHEN h."monitoringData" LIKE 'Preliminar · escalated · item %' THEN ', para avaliação completa'
    ELSE ''
  END
FROM "PreliminarySurvey" s
WHERE h."source" = 'Levantamento preliminar ' || s.id
  AND s."organizationId" = h."organizationId";

-- O levantamento que não existe mais não tem dia para dizer.
UPDATE "Hazard"
SET "source" = 'Levantamento preliminar'
WHERE "source" ~ '^Levantamento preliminar [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- A marca da situação em inglês não é dado de monitoramento.
UPDATE "Hazard"
SET "monitoringData" = NULL
WHERE "monitoringData" ~ '^Preliminar · (deferred|escalated) · item [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- A ação diferida: sem os identificadores, com o perigo pelo nome.
UPDATE "Action" a
SET "description" =
  'Origem: levantamento preliminar, sem medida imediata (NR-1 1.5.4.2.1.3).' || chr(10) ||
  'Perigo: ' || COALESCE(
    (SELECT h.description FROM "Hazard" h
      WHERE h.id = substring(a."description" from 'Perigo: ([0-9a-f-]{36})$')
        AND h."organizationId" = a."organizationId"),
    'registrado no inventário'
  )
WHERE a."description" ~ '^Origem: levantamento preliminar \(NR-1 1\.5\.4\.2\.1\.3\)\.\nItem: [0-9a-f-]{36}\nPerigo: [0-9a-f-]{36}$';
