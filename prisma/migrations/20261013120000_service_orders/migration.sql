-- Ordem de serviço de SST por função e a ciência do trabalhador. [S7-F]
ALTER TYPE "NotificationKind" ADD VALUE 'SERVICE_ORDER_ISSUED';

CREATE TABLE "ServiceOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobRoleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "duties" TEXT NOT NULL,
    "emergencyInstructions" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT NOT NULL,
    "responsibleName" TEXT NOT NULL,
    "responsibleRole" TEXT,
    "responsibleRegistration" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceOrderAck" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "serviceOrderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceOrderAck_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceOrder_organizationId_jobRoleId_version_key" ON "ServiceOrder"("organizationId", "jobRoleId", "version");
CREATE INDEX "ServiceOrder_organizationId_issuedAt_idx" ON "ServiceOrder"("organizationId", "issuedAt");
CREATE INDEX "ServiceOrder_jobRoleId_idx" ON "ServiceOrder"("jobRoleId");

CREATE UNIQUE INDEX "ServiceOrderAck_serviceOrderId_userId_key" ON "ServiceOrderAck"("serviceOrderId", "userId");
CREATE INDEX "ServiceOrderAck_organizationId_acknowledgedAt_idx" ON "ServiceOrderAck"("organizationId", "acknowledgedAt");

ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_jobRoleId_fkey" FOREIGN KEY ("jobRoleId") REFERENCES "JobRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ServiceOrderAck" ADD CONSTRAINT "ServiceOrderAck_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceOrderAck" ADD CONSTRAINT "ServiceOrderAck_serviceOrderId_fkey" FOREIGN KEY ("serviceOrderId") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceOrderAck" ADD CONSTRAINT "ServiceOrderAck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
