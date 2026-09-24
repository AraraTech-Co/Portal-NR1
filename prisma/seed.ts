import { AccountRole, PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const ACCOUNT_A = "00000000-0000-4000-8000-000000000002";
const ACCOUNT_B = "00000000-0000-4000-8000-000000000003";

async function main() {
  const passwordHash = await bcrypt.hash("admin123", 10);

  const org = await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: { name: "Organização Demo", active: true },
    create: {
      id: ORG_ID,
      name: "Organização Demo",
      taxId: null,
      active: true,
    },
  });

  const accountA = await prisma.account.upsert({
    where: { id: ACCOUNT_A },
    update: { name: "Conta Matriz", organizationId: org.id, active: true },
    create: {
      id: ACCOUNT_A,
      organizationId: org.id,
      name: "Conta Matriz",
      active: true,
    },
  });

  const accountB = await prisma.account.upsert({
    where: { id: ACCOUNT_B },
    update: { name: "Conta Filial", organizationId: org.id, active: true },
    create: {
      id: ACCOUNT_B,
      organizationId: org.id,
      name: "Conta Filial",
      active: true,
    },
  });

  const master = await prisma.user.upsert({
    where: { login: "master" },
    update: {
      email: "master@demo.local",
      name: "Master Empresa",
      passwordHash,
      active: true,
      mustChangePassword: false,
    },
    create: {
      login: "master",
      email: "master@demo.local",
      name: "Master Empresa",
      passwordHash,
      active: true,
      mustChangePassword: false,
    },
  });

  await prisma.membership.upsert({
    where: {
      userId_organizationId: {
        userId: master.id,
        organizationId: org.id,
      },
    },
    update: { role: Role.MASTER },
    create: {
      userId: master.id,
      organizationId: org.id,
      role: Role.MASTER,
      grants: [],
    },
  });

  const owner = await prisma.user.upsert({
    where: { login: "admin" },
    update: {
      email: "admin@demo.local",
      name: "Owner Conta Matriz",
      passwordHash,
      active: true,
      mustChangePassword: false,
    },
    create: {
      login: "admin",
      email: "admin@demo.local",
      name: "Owner Conta Matriz",
      passwordHash,
      active: true,
      mustChangePassword: false,
    },
  });

  await prisma.membership.upsert({
    where: {
      userId_organizationId: {
        userId: owner.id,
        organizationId: org.id,
      },
    },
    update: { role: Role.ADMIN },
    create: {
      userId: owner.id,
      organizationId: org.id,
      role: Role.ADMIN,
      grants: [],
    },
  });

  await prisma.accountMembership.upsert({
    where: {
      accountId_userId: {
        accountId: accountA.id,
        userId: owner.id,
      },
    },
    update: { role: AccountRole.OWNER },
    create: {
      accountId: accountA.id,
      userId: owner.id,
      role: AccountRole.OWNER,
    },
  });

  console.log("Seed OK");
  console.log("  master / admin123  → MASTER da empresa (todas as contas)");
  console.log(`    contas: ${accountA.name}, ${accountB.name}`);
  console.log("  admin  / admin123  → OWNER só da Conta Matriz");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
