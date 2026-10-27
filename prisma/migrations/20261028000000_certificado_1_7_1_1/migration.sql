-- O que o certificado pede (NR-1 1.7.1.1): quem ministra, com a qualificação,
-- e o responsável técnico pelo treinamento. [B3-3-G]
ALTER TABLE "Training" ADD COLUMN IF NOT EXISTS "instructorName" TEXT;
ALTER TABLE "Training" ADD COLUMN IF NOT EXISTS "instructorQualification" TEXT;
ALTER TABLE "Training" ADD COLUMN IF NOT EXISTS "technicalResponsibleName" TEXT;
ALTER TABLE "Training" ADD COLUMN IF NOT EXISTS "technicalResponsibleQualification" TEXT;
ALTER TABLE "TrainingSession" ADD COLUMN IF NOT EXISTS "instructorQualification" TEXT;
