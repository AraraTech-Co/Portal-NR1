-- O motivo da reavaliação gravado pela análise da ocorrência trazia o
-- identificador interno dela ("Ocorrência f1f3c29e-… analisada"). Passa a
-- trazer o dia da ocorrência, como o servidor grava agora: meia-noite UTC
-- exata é dia de calendário; com hora, vale o fuso de Brasília (o mesmo de
-- formatCalendarDay). Idempotente: depois de reescrito, o texto não casa
-- mais. [B2-4-E]
UPDATE "Risk" r
SET "reassessmentReason" =
  'Ocorrência de ' ||
  CASE
    WHEN o."occurredAt"::time = '00:00:00' THEN to_char(o."occurredAt", 'DD/MM/YYYY')
    ELSE to_char((o."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')
  END ||
  ' analisada — revisar medidas (1.5.5.5.2 c).'
FROM "Occurrence" o
WHERE r."reassessmentReason" = 'Ocorrência ' || o.id || ' analisada — revisar medidas (1.5.5.5.2 c).';

-- A ocorrência que não existe mais não tem dia para dizer: fica o motivo
-- sem o identificador.
UPDATE "Risk"
SET "reassessmentReason" = 'Ocorrência analisada — revisar medidas (1.5.5.5.2 c).'
WHERE "reassessmentReason" ~ '^Ocorrência [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} analisada — revisar medidas \(1\.5\.5\.5\.2 c\)\.$';
