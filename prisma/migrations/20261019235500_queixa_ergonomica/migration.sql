-- A queixa ergonômica de quem faz o trabalho. [P1]
--
-- Quem sente a dor é quem trabalha, e não tinha onde dizer isso: a
-- Avaliação ergonômica era só lista para o colaborador. A queixa é dele;
-- transformá-la em avaliação continua sendo do SST.
CREATE TYPE "ErgonomicComplaintStatus" AS ENUM ('OPEN', 'IN_EVALUATION', 'CLOSED');

CREATE TABLE "ErgonomicComplaint" (
  "id"              TEXT NOT NULL,
  "organizationId"  TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "bodyPart"        TEXT,
  "description"     TEXT NOT NULL,
  "establishmentId" TEXT,
  "jobRoleName"     TEXT,
  "status"          "ErgonomicComplaintStatus" NOT NULL DEFAULT 'OPEN',
  "aepId"           TEXT,
  "handledById"     TEXT,
  "handledAt"       TIMESTAMP(3),
  "handlingNote"    TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ErgonomicComplaint_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ErgonomicComplaint_organizationId_status_idx"
  ON "ErgonomicComplaint"("organizationId", "status");
CREATE INDEX "ErgonomicComplaint_userId_idx" ON "ErgonomicComplaint"("userId");

ALTER TABLE "ErgonomicComplaint" ADD CONSTRAINT "ErgonomicComplaint_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ErgonomicComplaint" ADD CONSTRAINT "ErgonomicComplaint_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ErgonomicComplaint" ADD CONSTRAINT "ErgonomicComplaint_establishmentId_fkey"
  FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ErgonomicComplaint" ADD CONSTRAINT "ErgonomicComplaint_aepId_fkey"
  FOREIGN KEY ("aepId") REFERENCES "Aep"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ErgonomicComplaint" ADD CONSTRAINT "ErgonomicComplaint_handledById_fkey"
  FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- O portal avisa o SST da queixa, e avisa de volta quem registrou. [P1]
ALTER TYPE "NotificationKind" ADD VALUE 'ERGONOMIC_COMPLAINT_OPENED';
ALTER TYPE "NotificationKind" ADD VALUE 'ERGONOMIC_COMPLAINT_HANDLED';
