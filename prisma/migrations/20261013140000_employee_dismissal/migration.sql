-- Desligamento com motivo e com autor: a data sozinha não conta a história. [S5-H]
ALTER TABLE "EmployeeProfile" ADD COLUMN "dismissalReason" TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN "dismissedById" TEXT;

ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_dismissedById_fkey" FOREIGN KEY ("dismissedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
