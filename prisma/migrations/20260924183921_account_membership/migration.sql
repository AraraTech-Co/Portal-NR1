-- CreateEnum
CREATE TYPE "AccountRole" AS ENUM ('OWNER', 'ADMIN', 'USER');

-- CreateTable
CREATE TABLE "account" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(256) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_membership" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "AccountRole" NOT NULL DEFAULT 'USER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_organization_id_idx" ON "account"("organization_id");

-- CreateIndex
CREATE INDEX "account_membership_account_id_role_idx" ON "account_membership"("account_id", "role");

-- CreateIndex
CREATE INDEX "account_membership_user_id_idx" ON "account_membership"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_membership_account_id_user_id_key" ON "account_membership"("account_id", "user_id");

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_membership" ADD CONSTRAINT "account_membership_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_membership" ADD CONSTRAINT "account_membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
