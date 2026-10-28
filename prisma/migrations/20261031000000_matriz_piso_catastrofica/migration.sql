-- Severidade 5 (Catastrófica) nunca fica abaixo de Moderado na matriz padrão.
--
-- Cada metodologia global ganha uma versão nova com as casas "5-x" abaixo de
-- Moderado levadas a Moderado; as versões antigas ficam como estão, porque a
-- avaliação guarda a versão que usou. Os riscos com avaliação vigente em
-- severidade 5 abaixo de Moderado numa metodologia global ficam marcados
-- para reavaliar. Metodologia própria de organização não muda.
--
-- Um bloco só, e idempotente: sem casa a corrigir, não cria versão.
DO $$
DECLARE
    v RECORD;
    nova jsonb;
BEGIN
    FOR v IN
        SELECT DISTINCT ON (mv."methodologyId") mv.*
        FROM "RiskMethodologyVersion" mv
        JOIN "RiskMethodology" m ON m."id" = mv."methodologyId"
        WHERE m."organizationId" IS NULL AND m."archivedAt" IS NULL
        ORDER BY mv."methodologyId", mv."version" DESC
    LOOP
        SELECT jsonb_object_agg(
                   e.k,
                   CASE WHEN e.k LIKE '5-%' AND e.nivel IN ('TRIVIAL', 'TOLERABLE')
                        THEN 'MODERATE' ELSE e.nivel END)
          INTO nova
          FROM jsonb_each_text(v."matrix"::jsonb) AS e(k, nivel);

        IF nova IS DISTINCT FROM v."matrix"::jsonb THEN
            INSERT INTO "RiskMethodologyVersion"
                ("id", "methodologyId", "version", "severityScale", "probabilityScale",
                 "matrix", "levels", "publishedAt", "createdAt")
            VALUES
                (gen_random_uuid()::text, v."methodologyId", v."version" + 1, v."severityScale",
                 v."probabilityScale", nova, v."levels", now(), now());
        END IF;
    END LOOP;

    UPDATE "Risk" r
       SET "needsReassessment" = true,
           "reassessmentReason" = 'A matriz padrão mudou: severidade Catastrófica passa a ser no mínimo Moderado. Avalie de novo.',
           "updatedAt" = now()
     WHERE r."archivedAt" IS NULL
       AND r."needsReassessment" = false
       AND EXISTS (
           SELECT 1
             FROM "RiskAssessment" a
             JOIN "RiskMethodologyVersion" mv ON mv."id" = a."methodologyVersionId"
             JOIN "RiskMethodology" m ON m."id" = mv."methodologyId"
            WHERE a."riskId" = r."id"
              AND a."status" IN ('DRAFT', 'IN_REVIEW', 'VALIDATED')
              AND m."organizationId" IS NULL
              AND a."severity" = 5
              AND a."resultingLevel" IN ('TRIVIAL', 'TOLERABLE'));
END $$;
