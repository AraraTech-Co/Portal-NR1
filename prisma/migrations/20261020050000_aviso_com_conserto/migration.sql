-- Aviso publicado não tinha conserto: nem corrigir um erro de digitação,
-- nem retirar do mural. Corrigir mexe em prova de comunicação de risco, então
-- o texto anterior fica guardado e a troca fica assinada. [S3-I]
ALTER TABLE "Announcement" ADD COLUMN "editedAt" TIMESTAMP(3);
ALTER TABLE "Announcement" ADD COLUMN "editedById" TEXT;
ALTER TABLE "Announcement" ADD COLUMN "withdrawnAt" TIMESTAMP(3);
ALTER TABLE "Announcement" ADD COLUMN "withdrawnById" TEXT;
ALTER TABLE "Announcement" ADD COLUMN "withdrawalReason" TEXT;

ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_editedById_fkey"
  FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_withdrawnById_fkey"
  FOREIGN KEY ("withdrawnById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AnnouncementRevision" (
  "id" TEXT NOT NULL,
  "announcementId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "happensAt" TIMESTAMP(3),
  "replacedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "replacedById" TEXT NOT NULL,

  CONSTRAINT "AnnouncementRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AnnouncementRevision_announcementId_replacedAt_idx"
  ON "AnnouncementRevision"("announcementId", "replacedAt");

ALTER TABLE "AnnouncementRevision" ADD CONSTRAINT "AnnouncementRevision_announcementId_fkey"
  FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnnouncementRevision" ADD CONSTRAINT "AnnouncementRevision_replacedById_fkey"
  FOREIGN KEY ("replacedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
