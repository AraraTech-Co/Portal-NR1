import { AccountRole, HazardCategory, HazardOrigin, HazardStatus, PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { defaultMethodologyVersion } from "./matriz-padrao";
import { senhaInicial } from "./senha-inicial";

const prisma = new PrismaClient();

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const ACCOUNT_A = "00000000-0000-4000-8000-000000000002";
const ACCOUNT_B = "00000000-0000-4000-8000-000000000003";
const METHOD_ID = "11111111-1111-4111-8111-111111111111";
const EST_ID = "00000000-0000-4000-8000-000000000010";
const SECTOR_ID = "00000000-0000-4000-8000-000000000011";
const JOB_ID = "00000000-0000-4000-8000-000000000012";
const ACT_ID = "00000000-0000-4000-8000-000000000013";
const HAZARD_ID = "00000000-0000-4000-8000-000000000014";
const RISK_ID = "00000000-0000-4000-8000-000000000015";

async function main() {
  // Antes de qualquer gravação: em produção sem senha definida, o seed para aqui.
  const inicial = senhaInicial();
  const passwordHash = await bcrypt.hash(inicial.senha, 10);
  // Com senha definida, ela só entra na criação; quem já existe mantém a sua.
  const senhaAoAtualizar = inicial.definida ? {} : { passwordHash, mustChangePassword: false };

  const org = await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: {
      name: "Organização Demo",
      active: true,
      taxId: "12.345.678/0001-90",
    },
    create: {
      id: ORG_ID,
      name: "Organização Demo",
      taxId: "12.345.678/0001-90",
      active: true,
      assessmentReviewMonths: 24,
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
      active: true,
      ...senhaAoAtualizar,
    },
    create: {
      login: "master",
      email: "master@demo.local",
      name: "Master Empresa",
      passwordHash,
      active: true,
      mustChangePassword: inicial.definida,
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
    },
  });

  const owner = await prisma.user.upsert({
    where: { login: "admin" },
    update: {
      email: "admin@demo.local",
      name: "Owner Conta Matriz",
      active: true,
      ...senhaAoAtualizar,
    },
    create: {
      login: "admin",
      email: "admin@demo.local",
      name: "Owner Conta Matriz",
      passwordHash,
      active: true,
      mustChangePassword: inicial.definida,
    },
  });

  await prisma.membership.upsert({
    where: {
      userId_organizationId: {
        userId: owner.id,
        organizationId: org.id,
      },
    },
    // Dono da conta, num papel só: OWNER manda nesta conta, MASTER alcança
    // todas as contas da empresa. [OB-3]
    update: { role: Role.OWNER },
    create: {
      userId: owner.id,
      organizationId: org.id,
      role: Role.OWNER,
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

  // —— GRO mínimo ——
  await prisma.riskMethodology.upsert({
    where: { id: METHOD_ID },
    update: { name: "Matriz 5x5 (padrão)", isDefault: true },
    create: {
      id: METHOD_ID,
      organizationId: null,
      name: "Matriz 5x5 (padrão)",
      description:
        "Metodologia inicial de referência: severidade × probabilidade em escala 1–5.",
      isDefault: true,
    },
  });

  const existingVersion = await prisma.riskMethodologyVersion.findFirst({
    where: { methodologyId: METHOD_ID, version: 1 },
  });
  if (!existingVersion) {
    const data = defaultMethodologyVersion();
    await prisma.riskMethodologyVersion.create({
      data: {
        methodologyId: METHOD_ID,
        version: 1,
        severityScale: data.severityScale,
        probabilityScale: data.probabilityScale,
        matrix: data.matrix,
        levels: data.levels,
      },
    });
  }

  const establishment = await prisma.establishment.upsert({
    where: { id: EST_ID },
    update: { name: "Planta Demo", organizationId: org.id },
    create: {
      id: EST_ID,
      organizationId: org.id,
      name: "Planta Demo",
      taxId: org.taxId,
      address: "Av. Industrial, 1000",
    },
  });

  const sector = await prisma.sector.upsert({
    where: { id: SECTOR_ID },
    update: { name: "Produção", establishmentId: establishment.id },
    create: {
      id: SECTOR_ID,
      organizationId: org.id,
      establishmentId: establishment.id,
      name: "Produção",
      description: "Área de usinagem",
      processDescription: "Usinagem de peças metálicas",
      environmentDescription: "Galpão industrial com ruído e partículas",
    },
  });

  const jobRole = await prisma.jobRole.upsert({
    where: { id: JOB_ID },
    update: { name: "Operador de Torno", sectorId: sector.id },
    create: {
      id: JOB_ID,
      organizationId: org.id,
      sectorId: sector.id,
      name: "Operador de Torno",
      description: "Opera torno mecânico/CNC",
    },
  });

  const activity = await prisma.activity.upsert({
    where: { id: ACT_ID },
    update: { name: "Usinagem de eixos", sectorId: sector.id },
    create: {
      id: ACT_ID,
      organizationId: org.id,
      establishmentId: establishment.id,
      sectorId: sector.id,
      name: "Usinagem de eixos",
      description: "Fixação, usinagem e inspeção de eixos",
    },
  });

  await prisma.activityJobRole.upsert({
    where: {
      activityId_jobRoleId: {
        activityId: activity.id,
        jobRoleId: jobRole.id,
      },
    },
    update: {},
    create: {
      activityId: activity.id,
      jobRoleId: jobRole.id,
    },
  });

  const hazard = await prisma.hazard.upsert({
    where: { id: HAZARD_ID },
    update: {
      description: "Projeção de cavacos durante usinagem",
      createdById: owner.id,
    },
    create: {
      id: HAZARD_ID,
      organizationId: org.id,
      activityId: activity.id,
      description: "Projeção de cavacos durante usinagem",
      source: "Ferramenta de corte em alta rotação",
      consequences: "Lesão ocular ou cutânea",
      exposedGroup: "Operadores de torno",
      exposedWorkersCount: 4,
      category: HazardCategory.ACCIDENT,
      status: HazardStatus.IDENTIFIED,
      origin: HazardOrigin.ROUTINE_REVIEW,
      createdById: owner.id,
    },
  });

  await prisma.risk.upsert({
    where: { id: RISK_ID },
    update: {
      description: "Risco de lesão por projeção de cavacos",
      hazardId: hazard.id,
    },
    create: {
      id: RISK_ID,
      organizationId: org.id,
      hazardId: hazard.id,
      description: "Risco de lesão por projeção de cavacos",
    },
  });

  console.log("Seed OK");
  const senhaMostrada = inicial.definida ? "(SEED_ADMIN_PASSWORD, trocar no 1º acesso)" : inicial.senha;
  console.log(`  master / ${senhaMostrada}  → MASTER (todas as contas)`);
  console.log(`    contas: ${accountA.name}, ${accountB.name}`);
  console.log(`  admin  / ${senhaMostrada}  → OWNER Conta Matriz`);
  console.log(
    `  GRO: ${establishment.name} → ${sector.name} → ${activity.name} → perigo/risco demo`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
