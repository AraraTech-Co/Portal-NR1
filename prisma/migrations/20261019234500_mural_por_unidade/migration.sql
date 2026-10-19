-- Quem publica escolhe quais unidades recebem o aviso. [CB-33]
--
-- Antes o aviso ia para todas as pessoas com acesso à organização, de todas
-- as unidades. Sem nenhuma linha aqui, o aviso continua indo para a empresa
-- toda — os avisos já publicados não mudam de público.
CREATE TABLE "AnnouncementEstablishment" (
  "announcementId"  TEXT NOT NULL,
  "establishmentId" TEXT NOT NULL,
  CONSTRAINT "AnnouncementEstablishment_pkey" PRIMARY KEY ("announcementId", "establishmentId")
);

CREATE INDEX "AnnouncementEstablishment_establishmentId_idx"
  ON "AnnouncementEstablishment"("establishmentId");

ALTER TABLE "AnnouncementEstablishment" ADD CONSTRAINT "AnnouncementEstablishment_announcementId_fkey"
  FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnnouncementEstablishment" ADD CONSTRAINT "AnnouncementEstablishment_establishmentId_fkey"
  FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
