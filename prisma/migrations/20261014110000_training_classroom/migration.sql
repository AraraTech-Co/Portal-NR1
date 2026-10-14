-- Treinamento presencial com turma, instrutor e lista de presença [S4-D],
-- e nota mínima para o certificado [S4-K].
CREATE TYPE "TrainingKind" AS ENUM ('ONLINE', 'CLASSROOM');

ALTER TYPE "EnrollmentStatus" ADD VALUE 'FAILED';

ALTER TABLE "Training" ADD COLUMN "kind" "TrainingKind" NOT NULL DEFAULT 'ONLINE';
ALTER TABLE "Training" ADD COLUMN "passingScore" INTEGER NOT NULL DEFAULT 70;

CREATE TABLE "TrainingSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "trainingId" TEXT NOT NULL,
    "heldAt" TIMESTAMP(3) NOT NULL,
    "instructorName" TEXT NOT NULL,
    "instructorRegistration" TEXT,
    "location" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingAttendance" (
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "present" BOOLEAN NOT NULL DEFAULT true,
    "score" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingAttendance_pkey" PRIMARY KEY ("sessionId", "userId")
);

CREATE INDEX "TrainingSession_organizationId_heldAt_idx" ON "TrainingSession"("organizationId", "heldAt");
CREATE INDEX "TrainingSession_trainingId_idx" ON "TrainingSession"("trainingId");
CREATE INDEX "TrainingAttendance_userId_idx" ON "TrainingAttendance"("userId");

ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_trainingId_fkey" FOREIGN KEY ("trainingId") REFERENCES "Training"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingAttendance" ADD CONSTRAINT "TrainingAttendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingAttendance" ADD CONSTRAINT "TrainingAttendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
