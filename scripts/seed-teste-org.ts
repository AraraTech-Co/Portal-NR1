/**
 * Seed isolado: org "teste" + 1 usuário por papel da matriz + mock em cada módulo.
 * Uso (no container): npx tsx scripts/seed-teste-org.ts
 */
import {
  AccountRole,
  AepMethod,
  AepStatus,
  AnnouncementKind,
  AssessmentStatus,
  CertificateStatus,
  ContractorRelation,
  ControlStatus,
  ControlType,
  EnrollmentStatus,
  ExamKind,
  HazardCategory,
  HazardOrigin,
  HazardStatus,
  HrDocumentKind,
  IdeaStatus,
  LeaveKind,
  LeaveStatus,
  OccurrenceType,
  PgrDocumentType,
  PrismaClient,
  ParticipationType,
  ReferralStatus,
  ReportCategory,
  ReportStatus,
  RequirementKind,
  Role,
  SurveyStatus,
  ActionPriority,
  ActionSourceType,
  ActionStatus,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { orgRoleToAccountRole } from "../server/src/helper/auth";

const prisma = new PrismaClient();

const PASSWORD = "teste1234";
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const ACCOUNT_ID = "aaaaaaaa-0001-4000-8000-000000000002";
const METHOD_ID = "aaaaaaaa-0001-4000-8000-000000000010";
const EST_ID = "aaaaaaaa-0001-4000-8000-000000000011";
const SECTOR_ID = "aaaaaaaa-0001-4000-8000-000000000012";
const JOB_ID = "aaaaaaaa-0001-4000-8000-000000000013";
const ACT_ID = "aaaaaaaa-0001-4000-8000-000000000014";

type Spec = {
  login: string;
  name: string;
  email: string;
  orgRole: Role;
  /** Se entra na conta. O papel dentro dela acompanha o da empresa. [OB-3] */
  naConta: boolean;
};

const USERS: Spec[] = [
  {
    login: "teste.master",
    name: "Master Teste",
    email: "teste.master@teste.local",
    orgRole: Role.MASTER,
    naConta: true,
  },
  {
    // O papel de conta OWNER virou papel de empresa OWNER: mesma coluna da
    // matriz e mesmo alcance de uma conta só. [OB-3]
    login: "teste.owner",
    name: "Owner Conta Teste",
    email: "teste.owner@teste.local",
    orgRole: Role.OWNER,
    naConta: true,
  },
  {
    login: "teste.sst",
    name: "Técnico SST Teste",
    email: "teste.sst@teste.local",
    orgRole: Role.SST,
    naConta: true,
  },
  {
    login: "teste.rh",
    name: "RH Teste",
    email: "teste.rh@teste.local",
    orgRole: Role.RH,
    naConta: true,
  },
  {
    login: "teste.supervisor",
    name: "Supervisor Teste",
    email: "teste.supervisor@teste.local",
    orgRole: Role.SUPERVISOR,
    naConta: true,
  },
  {
    login: "teste.gerente",
    name: "Gerente Teste",
    email: "teste.gerente@teste.local",
    orgRole: Role.GERENTE,
    naConta: true,
  },
  {
    login: "teste.admloja",
    name: "ADM Loja Teste",
    email: "teste.admloja@teste.local",
    orgRole: Role.ADM_LOJA,
    naConta: true,
  },
  {
    login: "teste.colaborador",
    name: "Colaborador Teste",
    email: "teste.colaborador@teste.local",
    orgRole: Role.COLABORADOR,
    naConta: true,
  },
  {
    login: "teste.fiscal",
    name: "Fiscal Teste",
    email: "teste.fiscal@teste.local",
    orgRole: Role.FISCAL,
    naConta: true,
  },
];

/** O fiscal sempre entra com prazo; no teste, um ano a partir do seed. */
function accessUntil(role: Role): Date | null {
  if (role !== Role.FISCAL) return null;
  const d = new Date();
  d.setDate(d.getDate() + 365);
  return d;
}

/*
  A fábrica de teste, e não uma loja: o portal é de NR-1 para a indústria, e
  quem testa via exemplos de varejo em todas as telas. [OB-11]
*/
const SETOR = {
  description: "Torneamento e fresagem de peças metálicas",
  processDescription: "Usinagem CNC de peças sob encomenda",
  environmentDescription: "Galpão industrial com ventilação natural e piso de concreto",
};
const PERIGO = {
  description: "Projeção de cavaco e contato com a placa girando",
  source: "Torno CNC",
  consequences: "Corte, lesão nos olhos, esmagamento da mão",
  exposedGroup: "Operadores de máquinas",
};
const EMERGENCIA = {
  scenario: "Evacuação por incêndio — Fábrica Teste",
  firstAidMeans: "Kit de primeiros socorros e lava-olhos na usinagem",
  responsibles: "Supervisor de produção",
  evacuationPlan: "Saída pelo portão lateral → pátio de estacionamento",
};

/*
  A consulta da denúncia compara o código com bcrypt, e o protocolo segue o
  formato que o portal gera (CX- e quatro dígitos). Gravado em SHA-256, como
  era, o exemplo nunca podia ser acompanhado. [OB-11]
*/
const DENUNCIA_DE_EXEMPLO = { protocolo: "CX-0001", codigo: "ACESSO-TESTE" };

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const codigoDaDenuncia = await bcrypt.hash(DENUNCIA_DE_EXEMPLO.codigo, 10);

  const org = await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: { name: "teste", active: true, taxId: "00.000.000/0001-91" },
    create: {
      id: ORG_ID,
      name: "teste",
      taxId: "00.000.000/0001-91",
      active: true,
      assessmentReviewMonths: 24,
      responsibleName: "Master Teste",
      responsibleRole: "Diretor SST",
    },
  });

  const account = await prisma.account.upsert({
    where: { id: ACCOUNT_ID },
    update: { name: "Conta Teste", organizationId: org.id, active: true },
    create: {
      id: ACCOUNT_ID,
      organizationId: org.id,
      name: "Conta Teste",
      active: true,
    },
  });

  const created: {
    login: string;
    password: string;
    name: string;
    orgRole: string;
    accountRole: string | null;
    id: string;
  }[] = [];
  const byLogin: Record<string, string> = {};

  for (const spec of USERS) {
    const user = await prisma.user.upsert({
      where: { login: spec.login },
      update: {
        email: spec.email,
        name: spec.name,
        passwordHash,
        active: true,
        mustChangePassword: false,
      },
      create: {
        login: spec.login,
        email: spec.email,
        name: spec.name,
        passwordHash,
        active: true,
        mustChangePassword: false,
      },
    });
    byLogin[spec.login] = user.id;

    await prisma.membership.upsert({
      where: {
        userId_organizationId: {
          userId: user.id,
          organizationId: org.id,
        },
      },
      update: { role: spec.orgRole, accessExpiresAt: accessUntil(spec.orgRole) },
      create: {
        userId: user.id,
        organizationId: org.id,
        role: spec.orgRole,
        accessExpiresAt: accessUntil(spec.orgRole),
      },
    });

    if (spec.naConta) {
      const papelNaConta = orgRoleToAccountRole(spec.orgRole);
      await prisma.accountMembership.upsert({
        where: {
          accountId_userId: {
            accountId: account.id,
            userId: user.id,
          },
        },
        update: { role: papelNaConta },
        create: {
          accountId: account.id,
          userId: user.id,
          role: papelNaConta,
        },
      });
    }

    created.push({
      login: spec.login,
      password: PASSWORD,
      name: spec.name,
      orgRole: spec.orgRole,
      accountRole: spec.naConta ? orgRoleToAccountRole(spec.orgRole) : null,
      id: user.id,
    });
  }

  const masterId = byLogin["teste.master"];
  const rhId = byLogin["teste.rh"];
  const sstId = byLogin["teste.sst"];
  const colabId = byLogin["teste.colaborador"];
  const supervisorId = byLogin["teste.supervisor"];

  await prisma.riskMethodology.upsert({
    where: { id: METHOD_ID },
    update: { name: "Matriz 5x5 Teste" },
    create: {
      id: METHOD_ID,
      organizationId: org.id,
      name: "Matriz 5x5 Teste",
      description: "Metodologia mock da org teste",
      isDefault: false,
    },
  });
  const methodVer =
    (await prisma.riskMethodologyVersion.findFirst({
      where: { methodologyId: METHOD_ID, version: 1 },
    })) ??
    (await prisma.riskMethodologyVersion.create({
      data: {
        methodologyId: METHOD_ID,
        version: 1,
        severityScale: [
          { value: 1, label: "Baixa" },
          { value: 5, label: "Alta" },
        ],
        probabilityScale: [
          { value: 1, label: "Rara" },
          { value: 5, label: "Frequente" },
        ],
        matrix: { "1-1": "TRIVIAL", "5-5": "INTOLERABLE" },
        levels: [
          { id: "TRIVIAL", label: "Trivial", order: 1 },
          { id: "INTOLERABLE", label: "Intolerável", order: 5 },
        ],
      },
    }));

  const establishment = await prisma.establishment.upsert({
    where: { id: EST_ID },
    update: { name: "Fábrica Teste Centro", organizationId: org.id },
    create: {
      id: EST_ID,
      organizationId: org.id,
      name: "Fábrica Teste Centro",
      taxId: org.taxId,
      address: "Rua Teste, 100 — Americana/SP",
    },
  });

  const sector = await prisma.sector.upsert({
    where: { id: SECTOR_ID },
    update: {
      name: "Usinagem",
      establishmentId: establishment.id,
      description: SETOR.description,
      processDescription: SETOR.processDescription,
      environmentDescription: SETOR.environmentDescription,
    },
    create: {
      id: SECTOR_ID,
      organizationId: org.id,
      establishmentId: establishment.id,
      name: "Usinagem",
      ...SETOR,
    },
  });

  const jobRole = await prisma.jobRole.upsert({
    where: { id: JOB_ID },
    update: {
      name: "Operador de máquinas",
      sectorId: sector.id,
      description: "Prepara, opera e confere peças no torno e na fresadora CNC",
    },
    create: {
      id: JOB_ID,
      organizationId: org.id,
      sectorId: sector.id,
      name: "Operador de máquinas",
      description: "Prepara, opera e confere peças no torno e na fresadora CNC",
    },
  });

  const activity = await prisma.activity.upsert({
    where: { id: ACT_ID },
    update: {
      name: "Operação do torno CNC",
      sectorId: sector.id,
      description: "Fixa a peça, opera o torno e retira a peça usinada",
    },
    create: {
      id: ACT_ID,
      organizationId: org.id,
      establishmentId: establishment.id,
      sectorId: sector.id,
      name: "Operação do torno CNC",
      description: "Fixa a peça, opera o torno e retira a peça usinada",
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
    create: { activityId: activity.id, jobRoleId: jobRole.id },
  });

  const hazard = await prisma.hazard.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000020" },
    update: { ...PERIGO },
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000020",
      organizationId: org.id,
      activityId: activity.id,
      ...PERIGO,
      exposedWorkersCount: 8,
      category: HazardCategory.ACCIDENT,
      status: HazardStatus.IDENTIFIED,
      origin: HazardOrigin.ROUTINE_REVIEW,
      createdById: sstId,
    },
  });

  const risk = await prisma.risk.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000021" },
    update: { description: "Corte ou lesão nos olhos por cavaco" },
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000021",
      organizationId: org.id,
      hazardId: hazard.id,
      description: "Corte ou lesão nos olhos por cavaco",
    },
  });

  await prisma.riskAssessment.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000022" },
    update: {},
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000022",
      organizationId: org.id,
      riskId: risk.id,
      methodologyVersionId: methodVer.id,
      severity: 3,
      probability: 3,
      resultingLevel: "MODERATE",
      status: AssessmentStatus.VALIDATED,
      assessorId: sstId,
      validatedById: masterId,
      validatedAt: new Date(),
      expiresAt: new Date(Date.now() + 730 * 86400000),
    },
  });

  await prisma.controlMeasure.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000023" },
    update: { description: "Proteção móvel da placa com intertravamento" },
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000023",
      organizationId: org.id,
      riskId: risk.id,
      type: ControlType.ENGINEERING,
      description: "Proteção móvel da placa com intertravamento",
      status: ControlStatus.IMPLEMENTED,
      implementedAt: new Date(),
    },
  });

  await prisma.action.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000030" },
    update: { title: "Instalar o anteparo de cavaco no torno 2" },
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000030",
      organizationId: org.id,
      title: "Instalar o anteparo de cavaco no torno 2",
      description: "Ação mock do inventário",
      status: ActionStatus.IN_PROGRESS,
      priority: ActionPriority.HIGH,
      sourceType: ActionSourceType.RISK,
      riskId: risk.id,
      assigneeId: supervisorId,
      createdById: sstId,
      dueDate: new Date(Date.now() + 14 * 86400000),
    },
  });

  await prisma.aep.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000031" },
    update: {
      scopeDescription: "Posto do torno CNC — fábrica teste",
      findings: "Trabalho em pé prolongado; elevação de braço ao fixar peças pesadas na placa.",
    },
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000031",
      organizationId: org.id,
      establishmentId: establishment.id,
      sectorId: sector.id,
      activityId: activity.id,
      scopeDescription: "Posto do torno CNC — fábrica teste",
      method: AepMethod.OBSERVATION,
      methodRationale: "Observação direta do posto",
      findings: "Trabalho em pé prolongado; elevação de braço ao fixar peças pesadas na placa.",
      status: AepStatus.CONCLUDED,
      conductedById: sstId,
      concludedAt: new Date(),
      workersConsulted: 3,
    },
  });

  await prisma.occurrence.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000032" },
    update: { description: "Quase atingido por cavaco ao abrir a porta do torno com a placa girando" },
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000032",
      organizationId: org.id,
      establishmentId: establishment.id,
      type: OccurrenceType.DANGEROUS_EVENT,
      description: "Quase atingido por cavaco ao abrir a porta do torno com a placa girando",
      occurredAt: new Date(Date.now() - 3 * 86400000),
      reportedById: colabId,
    },
  });

  const emergency = await prisma.emergencyProcedure.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000033" },
    update: { ...EMERGENCIA },
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000033",
      organizationId: org.id,
      establishmentId: establishment.id,
      ...EMERGENCIA,
      drillFrequencyMonths: 12,
    },
  });

  await prisma.emergencyDrill.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000034" },
    update: {},
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000034",
      procedureId: emergency.id,
      performedAt: new Date(Date.now() - 30 * 86400000),
      participants: 12,
      findings: "Simulado mock — 4 min",
      recordedById: sstId,
    },
  });

  await prisma.pgrDocument.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000035" },
    update: {},
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000035",
      organizationId: org.id,
      establishmentId: establishment.id,
      type: PgrDocumentType.INVENTORY,
      version: 1,
      content: { summary: "Inventário mock org teste", risks: 1 },
      issuedById: sstId,
      responsibleName: "Técnico SST Teste",
      responsibleRole: "SST",
      signatureStatement: "Assinado eletronicamente para fins de seed.",
    },
  });

  await prisma.contractor.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000036" },
    update: {},
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000036",
      organizationId: org.id,
      establishmentId: establishment.id,
      name: "Limpeza Express LTDA",
      taxId: "11.111.111/0001-11",
      relation: ContractorRelation.WE_HIRE,
      servicesScope: "Limpeza noturna",
      documentsReceivedAt: new Date(),
      risksInformedAt: new Date(),
    },
  });

  const profileSpecs: [string, string, string][] = [
    // CPFs válidos (dígito verificador correto) — fictícios. [S5-N]
    ["teste.colaborador", "COL-001", "52998224725"],
    ["teste.supervisor", "SUP-001", "11144477735"],
    ["teste.rh", "RH-001", "00000000191"],
  ];
  for (const [login, registration, taxId] of profileSpecs) {
    const uid = byLogin[login];
    await prisma.employeeProfile.upsert({
      where: {
        organizationId_userId: {
          organizationId: org.id,
          userId: uid,
        },
      },
      update: { registration, taxId, jobRoleId: jobRole.id },
      create: {
        organizationId: org.id,
        userId: uid,
        jobRoleId: jobRole.id,
        registration,
        taxId,
        admittedAt: new Date("2024-01-15"),
      },
    });
  }

  await prisma.hrDocument.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000040" },
    update: {},
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000040",
      organizationId: org.id,
      kind: HrDocumentKind.TERM,
      title: "Termo de ciência — NR-1 mock",
      description: "Documento geral da org teste",
      storagePath: "mock/termo-nr1.pdf",
      fileName: "termo-nr1.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      requiresAck: true,
      publishedById: rhId,
    },
  });

  await prisma.payslip.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000041" },
    update: {},
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000041",
      organizationId: org.id,
      userId: colabId,
      referenceMonth: 9,
      referenceYear: 2026,
      storagePath: "mock/holerite-colab-2026-09.pdf",
      fileName: "holerite-2026-09.pdf",
      publishedById: rhId,
    },
  });

  await prisma.leaveRequest.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000042" },
    update: {},
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000042",
      organizationId: org.id,
      userId: colabId,
      kind: LeaveKind.VACATION,
      startDate: new Date("2026-12-01"),
      endDate: new Date("2026-12-15"),
      days: 15,
      status: LeaveStatus.REQUESTED,
      note: "Pedido mock de férias",
    },
  });

  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  /*
    Cada movimento do banco de horas é um lançamento próprio, sem chave única
    por pessoa e dia [CB-66]: o seed procura o seu e só cria se não achar,
    para rodar de novo sem duplicar.
  */
  const lancamentoMock = await prisma.timeEntry.findFirst({
    where: {
      organizationId: org.id,
      userId: colabId,
      day,
      note: "Lançamento mock",
    },
  });
  if (!lancamentoMock) {
    await prisma.timeEntry.create({
      data: {
        organizationId: org.id,
        userId: colabId,
        day,
        in1: "08:00",
        out1: "12:00",
        in2: "13:00",
        out2: "17:00",
        balanceMinutes: 0,
        note: "Lançamento mock",
      },
    });
  }

  const step = await prisma.onboardingStep.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000043" },
    update: {},
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000043",
      organizationId: org.id,
      title: "Assinar termo de integração",
      description: "Passo mock de onboarding",
      order: 1,
    },
  });
  await prisma.onboardingProgress.upsert({
    where: { stepId_userId: { stepId: step.id, userId: colabId } },
    update: {},
    create: { stepId: step.id, userId: colabId, doneAt: new Date() },
  });

  await prisma.referral.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000044" },
    update: { position: "Operador de máquinas" },
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000044",
      organizationId: org.id,
      referrerUserId: supervisorId,
      candidateName: "Ana Candidata",
      email: "ana@exemplo.com",
      position: "Operador de máquinas",
      status: ReferralStatus.RECEIVED,
      note: "Indicação mock",
    },
  });

  await prisma.jobRoleRequirement.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000045" },
    update: {},
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000045",
      organizationId: org.id,
      jobRoleId: jobRole.id,
      kind: RequirementKind.EXAM,
      name: "ASO admissional / periódico",
      description: "Exame ocupacional",
    },
  });

  await prisma.workerCertificate.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000046" },
    update: {},
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000046",
      organizationId: org.id,
      userId: colabId,
      name: "Curso de atendimento",
      issuedAt: new Date("2025-06-01"),
      expiresAt: new Date("2027-06-01"),
      status: CertificateStatus.APPROVED,
      reviewedById: rhId,
      reviewedAt: new Date(),
      storagePath: "mock/cert-atendimento.pdf",
      fileName: "cert-atendimento.pdf",
    },
  });

  await prisma.occupationalExam.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000047" },
    update: {},
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000047",
      organizationId: org.id,
      userId: colabId,
      kind: ExamKind.PERIODIC,
      performedAt: new Date("2026-03-10"),
      dueAt: new Date("2027-03-10"),
      fit: true,
    },
  });

  await prisma.medicalCertificate.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000048" },
    update: {},
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000048",
      organizationId: org.id,
      userId: colabId,
      startDate: new Date("2026-08-01"),
      cid: "J06",
      days: 2,
      status: CertificateStatus.APPROVED,
      storagePath: "mock/atestado.pdf",
      fileName: "atestado.pdf",
      reviewedById: rhId,
      reviewedAt: new Date(),
    },
  });

  const training = await prisma.training.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000049" },
    update: {},
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000049",
      organizationId: org.id,
      title: "Integração SST — mock",
      category: "SST",
      summary: "Treinamento introdutório NR-1",
      durationMinutes: 45,
      points: 50,
      createdById: rhId,
      validityMonths: 24,
    },
  });
  await prisma.trainingSlide.upsert({
    where: { trainingId_order: { trainingId: training.id, order: 1 } },
    update: {},
    create: {
      trainingId: training.id,
      order: 1,
      title: "Boas-vindas",
      body: "Conteúdo mock do slide 1",
    },
  });
  await prisma.trainingEnrollment.upsert({
    where: {
      trainingId_userId: { trainingId: training.id, userId: colabId },
    },
    update: {},
    create: {
      trainingId: training.id,
      userId: colabId,
      status: EnrollmentStatus.COMPLETED,
      startedAt: new Date(),
      completedAt: new Date(),
      score: 90,
      certificateCode: `CERT-TESTE-${colabId.slice(0, 8)}`,
    },
  });

  await prisma.participationRecord.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000050" },
    update: { description: "Pauta: proteções das máquinas da usinagem" },
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000050",
      organizationId: org.id,
      establishmentId: establishment.id,
      type: ParticipationType.MEETING,
      subject: "Reunião CIPA mock",
      description: "Pauta: proteções das máquinas da usinagem",
      occurredAt: new Date(Date.now() - 10 * 86400000),
      recordedById: sstId,
      participantsCount: 5,
    },
  });

  await prisma.ethicsReport.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000051" },
    /* Corrige o exemplo já gravado com o código em SHA-256. */
    update: { protocol: DENUNCIA_DE_EXEMPLO.protocolo, accessCodeHash: codigoDaDenuncia },
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000051",
      organizationId: org.id,
      protocol: DENUNCIA_DE_EXEMPLO.protocolo,
      category: ReportCategory.MISCONDUCT,
      description: "Relato mock anônimo para o comitê",
      isAnonymous: true,
      accessCodeHash: codigoDaDenuncia,
      status: ReportStatus.IN_ANALYSIS,
      establishmentId: establishment.id,
    },
  });

  const survey = await prisma.climateSurvey.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000052" },
    update: {},
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000052",
      organizationId: org.id,
      title: "Pesquisa de clima — mock",
      status: SurveyStatus.OPEN,
      createdById: rhId,
      opensAt: new Date(Date.now() - 7 * 86400000),
    },
  });
  await prisma.climateQuestion.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000053" },
    update: {},
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000053",
      surveyId: survey.id,
      order: 1,
      prompt: "Como você avalia o ambiente de trabalho?",
    },
  });

  await prisma.idea.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000054" },
    update: {
      title: "Faixa de piso em volta dos tornos",
      description: "Ideia mock: marcar no piso a área de circulação perto das máquinas",
    },
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000054",
      organizationId: org.id,
      authorUserId: colabId,
      title: "Faixa de piso em volta dos tornos",
      description: "Ideia mock: marcar no piso a área de circulação perto das máquinas",
      status: IdeaStatus.NEW,
    },
  });

  await prisma.announcement.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000055" },
    update: {},
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000055",
      organizationId: org.id,
      kind: AnnouncementKind.NOTICE,
      title: "Bem-vindos à org teste",
      body: "Aviso mock do mural.\n\nUse os logins `teste.*` para validar a matriz.",
      publishedById: rhId,
      happensAt: new Date(),
    },
  });

  await prisma.pointRule.upsert({
    where: {
      organizationId_activity: {
        organizationId: org.id,
        activity: "TRAINING_COMPLETE",
      },
    },
    update: { points: 50 },
    create: {
      organizationId: org.id,
      activity: "TRAINING_COMPLETE",
      points: 50,
    },
  });

  const existingPoints = await prisma.pointEntry.findFirst({
    where: {
      organizationId: org.id,
      userId: colabId,
      activity: "TRAINING_COMPLETE",
      note: "Seed mock",
    },
  });
  if (!existingPoints) {
    await prisma.pointEntry.create({
      data: {
        organizationId: org.id,
        userId: colabId,
        activity: "TRAINING_COMPLETE",
        points: 50,
        note: "Seed mock",
        grantedById: rhId,
      },
    });
  }

  await prisma.reward.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000056" },
    update: {},
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000056",
      organizationId: org.id,
      name: "Vale lanche",
      description: "Recompensa mock",
      cost: 100,
      stock: 10,
    },
  });

  await prisma.summon.upsert({
    where: { id: "aaaaaaaa-0001-4000-8000-000000000057" },
    update: { title: "DDS — proteções do torno" },
    create: {
      id: "aaaaaaaa-0001-4000-8000-000000000057",
      organizationId: org.id,
      title: "DDS — proteções do torno",
      description: "Convocação mock",
      scheduledFor: new Date(Date.now() + 2 * 86400000),
      location: "Sala de reunião",
      createdById: rhId,
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        org: org.name,
        account: account.name,
        users: created,
        denuncia_de_exemplo: DENUNCIA_DE_EXEMPLO,
      },
      null,
      2,
    ),
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
