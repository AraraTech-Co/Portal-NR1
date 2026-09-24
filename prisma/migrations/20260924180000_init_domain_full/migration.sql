-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('MASTER', 'ADMIN', 'SST', 'RH', 'COLABORADOR');

-- CreateEnum
CREATE TYPE "AccountRole" AS ENUM ('OWNER', 'ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "InviteRoleMode" AS ENUM ('FIXED', 'ON_APPROVE');

-- CreateEnum
CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "HazardStatus" AS ENUM ('IDENTIFIED', 'CONFIRMED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "HazardCategory" AS ENUM ('PHYSICAL', 'CHEMICAL', 'BIOLOGICAL', 'ERGONOMIC', 'PSYCHOSOCIAL', 'ACCIDENT');

-- CreateEnum
CREATE TYPE "HazardOrigin" AS ENUM ('INSPECTION', 'WORKER_REPORT', 'INCIDENT', 'ROUTINE_REVIEW', 'AI_SUGGESTION', 'OTHER');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'VALIDATED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ControlType" AS ENUM ('ELIMINATION', 'SUBSTITUTION', 'ENGINEERING', 'ADMINISTRATIVE', 'PPE');

-- CreateEnum
CREATE TYPE "ControlStatus" AS ENUM ('PLANNED', 'IMPLEMENTED', 'INEFFECTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_VALIDATION', 'VALIDATED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ActionPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ActionSourceType" AS ENUM ('RISK', 'CHANGE_EVENT', 'OCCURRENCE', 'AUDIT', 'LEGAL_REQUIREMENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('PHOTO', 'VIDEO', 'DOCUMENT', 'CERTIFICATE', 'CHECKLIST', 'MEASUREMENT', 'INVOICE', 'INSPECTION', 'SIGNATURE', 'OTHER');

-- CreateEnum
CREATE TYPE "EvidenceValidationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ChangeEventType" AS ENUM ('NEW_EQUIPMENT', 'PROCESS_CHANGE', 'ENVIRONMENT_CHANGE', 'JOB_CHANGE', 'NEW_ACTIVITY', 'CHEMICAL_CHANGE', 'WORK_SCHEDULE_CHANGE', 'ORGANIZATIONAL_CHANGE', 'ACCIDENT', 'DANGEROUS_EVENT', 'LEGAL_CHANGE', 'WORKER_REQUEST', 'CONTROL_IMPLEMENTED');

-- CreateEnum
CREATE TYPE "PgrDocumentType" AS ENUM ('INVENTORY', 'ACTION_PLAN', 'CRITERIA', 'AEP');

-- CreateEnum
CREATE TYPE "AepMethod" AS ENUM ('OBSERVATION', 'INTERVIEW', 'QUESTIONNAIRE', 'WORKSHOP', 'FOCUS_GROUP', 'COMBINED');

-- CreateEnum
CREATE TYPE "AepStatus" AS ENUM ('DRAFT', 'CONCLUDED');

-- CreateEnum
CREATE TYPE "ParticipationType" AS ENUM ('CONSULTATION', 'CIPA_MANIFESTATION', 'MEETING', 'RISK_COMMUNICATION', 'BASIC_TRAINING', 'WORKSHOP');

-- CreateEnum
CREATE TYPE "SurveyTrigger" AS ENUM ('BEFORE_START', 'EXISTING_ACTIVITIES', 'CHANGE_OR_NEW_PROCESS');

-- CreateEnum
CREATE TYPE "SurveyOutcome" AS ENUM ('HAZARD_AVOIDED', 'IMMEDIATE_MEASURE', 'DEFERRED_TO_ACTION_PLAN', 'ESCALATED_TO_ASSESSMENT');

-- CreateEnum
CREATE TYPE "OccurrenceType" AS ENUM ('ACCIDENT', 'OCCUPATIONAL_DISEASE', 'DANGEROUS_EVENT');

-- CreateEnum
CREATE TYPE "ContractorRelation" AS ENUM ('WE_HIRE', 'WE_ARE_HIRED');

-- CreateEnum
CREATE TYPE "ReportCategory" AS ENUM ('HARASSMENT_MORAL', 'HARASSMENT_SEXUAL', 'DISCRIMINATION', 'MISCONDUCT', 'FRAUD_OR_MISUSE', 'DATA_LEAK', 'SAFETY_RISK', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('RECEIVED', 'IN_ANALYSIS', 'AWAITING_INFO', 'RESOLVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ReportAuthorSide" AS ENUM ('REPORTER', 'COMMITTEE');

-- CreateEnum
CREATE TYPE "IdeaStatus" AS ENUM ('NEW', 'IN_ANALYSIS', 'IMPLEMENTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AnnouncementKind" AS ENUM ('NOTICE', 'CAMPAIGN', 'TRAINING');

-- CreateEnum
CREATE TYPE "HrDocumentKind" AS ENUM ('CONTRACT', 'WARNING', 'NOTICE', 'RECEIPT', 'TERM', 'OTHER');

-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LeaveKind" AS ENUM ('VACATION', 'LEAVE', 'DAY_OFF');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SummonAttendanceStatus" AS ENUM ('INVITED', 'CONFIRMED', 'ATTENDED', 'ABSENT');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RequirementKind" AS ENUM ('CERTIFICATE', 'EXAM', 'TRAINING');

-- CreateEnum
CREATE TYPE "ExamKind" AS ENUM ('ADMISSIONAL', 'PERIODIC', 'RETURN_TO_WORK', 'ROLE_CHANGE', 'DISMISSAL');

-- CreateEnum
CREATE TYPE "SurveyStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('REQUESTED', 'APPROVED', 'DELIVERED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('RECEIVED', 'IN_PROCESS', 'HIRED', 'DISCARDED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "emailVerifiedAt" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "assessmentReviewMonths" INTEGER NOT NULL DEFAULT 24,
    "hasSstCertification" BOOLEAN NOT NULL DEFAULT false,
    "responsibleName" TEXT,
    "responsibleRole" TEXT,
    "responsibleRegistration" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'COLABORADOR',
    "grants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountMembership" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "AccountRole" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountInviteLink" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "roleMode" "InviteRoleMode" NOT NULL DEFAULT 'ON_APPROVE',
    "role" "AccountRole" NOT NULL DEFAULT 'USER',
    "orgRole" "Role" NOT NULL DEFAULT 'COLABORADOR',
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountInviteLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountJoinRequest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "inviteLinkId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedRole" "AccountRole",
    "decidedOrgRole" "Role",
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountJoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Token" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Establishment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "address" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Establishment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sector" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "establishmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "processDescription" TEXT,
    "environmentDescription" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRole" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "establishmentId" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityJobRole" (
    "activityId" TEXT NOT NULL,
    "jobRoleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityJobRole_pkey" PRIMARY KEY ("activityId","jobRoleId")
);

-- CreateTable
CREATE TABLE "Hazard" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source" TEXT,
    "consequences" TEXT,
    "exposedGroup" TEXT,
    "exposedWorkersCount" INTEGER,
    "exposureTime" TEXT,
    "exposureFrequency" TEXT,
    "exposureIntensity" TEXT,
    "monitoringData" TEXT,
    "aepId" TEXT,
    "category" "HazardCategory" NOT NULL DEFAULT 'ACCIDENT',
    "status" "HazardStatus" NOT NULL DEFAULT 'IDENTIFIED',
    "origin" "HazardOrigin" NOT NULL DEFAULT 'ROUTINE_REVIEW',
    "createdById" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hazard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Risk" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hazardId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "needsReassessment" BOOLEAN NOT NULL DEFAULT false,
    "reassessmentReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Risk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskMethodology" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskMethodology_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskMethodologyVersion" (
    "id" TEXT NOT NULL,
    "methodologyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "severityScale" JSONB NOT NULL,
    "probabilityScale" JSONB NOT NULL,
    "matrix" JSONB NOT NULL,
    "levels" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskMethodologyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskAssessment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "methodologyVersionId" TEXT NOT NULL,
    "severity" INTEGER NOT NULL,
    "probability" INTEGER NOT NULL,
    "resultingLevel" TEXT NOT NULL,
    "severityReason" TEXT,
    "probabilityReason" TEXT,
    "controlsConsidered" TEXT,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "assessorId" TEXT NOT NULL,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "validatedById" TEXT,
    "validatedAt" TIMESTAMP(3),
    "supersededById" TEXT,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlMeasure" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "type" "ControlType" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ControlStatus" NOT NULL DEFAULT 'PLANNED',
    "implementedAt" TIMESTAMP(3),
    "effectivenessStatus" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ControlMeasure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sourceType" "ActionSourceType" NOT NULL DEFAULT 'MANUAL',
    "riskId" TEXT,
    "changeEventId" TEXT,
    "controlId" TEXT,
    "occurrenceId" TEXT,
    "priority" "ActionPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "ActionStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeId" TEXT,
    "dueDate" TIMESTAMP(3),
    "effectivenessCriteria" TEXT,
    "effectivenessResult" TEXT,
    "createdById" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "validatedById" TEXT,
    "validatedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "EvidenceType" NOT NULL DEFAULT 'DOCUMENT',
    "storagePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "description" TEXT,
    "eventDate" TIMESTAMP(3),
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validationStatus" "EvidenceValidationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "actionId" TEXT,
    "participationId" TEXT,
    "occurrenceId" TEXT,
    "drillId" TEXT,
    "aepId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "establishmentId" TEXT,
    "type" "ChangeEventType" NOT NULL,
    "description" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PgrDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "establishmentId" TEXT,
    "type" "PgrDocumentType" NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT NOT NULL,
    "responsibleName" TEXT NOT NULL,
    "responsibleRole" TEXT,
    "responsibleRegistration" TEXT,
    "signatureStatement" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PgrDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Aep" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "establishmentId" TEXT NOT NULL,
    "sectorId" TEXT,
    "activityId" TEXT,
    "scopeDescription" TEXT NOT NULL,
    "method" "AepMethod" NOT NULL DEFAULT 'OBSERVATION',
    "methodRationale" TEXT,
    "anonymityMeasures" TEXT,
    "workersConsulted" INTEGER,
    "findings" TEXT,
    "status" "AepStatus" NOT NULL DEFAULT 'DRAFT',
    "conductedById" TEXT NOT NULL,
    "conductedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concludedAt" TIMESTAMP(3),
    "needsAet" BOOLEAN NOT NULL DEFAULT false,
    "aetReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Aep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParticipationRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "establishmentId" TEXT,
    "type" "ParticipationType" NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "participantsCount" INTEGER,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParticipationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreliminarySurvey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "establishmentId" TEXT NOT NULL,
    "trigger" "SurveyTrigger" NOT NULL,
    "description" TEXT,
    "conductedById" TEXT NOT NULL,
    "conductedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreliminarySurvey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreliminarySurveyItem" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "activityId" TEXT,
    "description" TEXT NOT NULL,
    "outcome" "SurveyOutcome" NOT NULL,
    "measureTaken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreliminarySurveyItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Occurrence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "establishmentId" TEXT,
    "riskId" TEXT,
    "type" "OccurrenceType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "generatingSituation" TEXT,
    "organizationalData" TEXT,
    "preventionReview" TEXT,
    "analyzedById" TEXT,
    "analyzedAt" TIMESTAMP(3),
    "reportedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Occurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyProcedure" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "establishmentId" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "firstAidMeans" TEXT,
    "responsibles" TEXT,
    "evacuationPlan" TEXT,
    "largeScaleMeasures" TEXT,
    "drillFrequencyMonths" INTEGER,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyProcedure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyDrill" (
    "id" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL,
    "participants" INTEGER,
    "findings" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmergencyDrill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contractor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "establishmentId" TEXT,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "relation" "ContractorRelation" NOT NULL DEFAULT 'WE_HIRE',
    "servicesScope" TEXT,
    "documentsReceivedAt" TIMESTAMP(3),
    "documentsNotes" TEXT,
    "risksInformedAt" TIMESTAMP(3),
    "interactionMeasures" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contractor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EthicsReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "category" "ReportCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT true,
    "reporterUserId" TEXT,
    "accessCodeHash" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'RECEIVED',
    "establishmentId" TEXT,
    "linkedHazardId" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EthicsReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EthicsReportMessage" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "side" "ReportAuthorSide" NOT NULL,
    "body" TEXT NOT NULL,
    "authorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readByCommitteeAt" TIMESTAMP(3),
    "readByReporterAt" TIMESTAMP(3),

    CONSTRAINT "EthicsReportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "registration" TEXT,
    "taxId" TEXT,
    "phone" TEXT,
    "jobRoleId" TEXT,
    "admittedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Idea" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "IdeaStatus" NOT NULL DEFAULT 'NEW',
    "decisionNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Idea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "AnnouncementKind" NOT NULL DEFAULT 'NOTICE',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "happensAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "publishedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementRead" (
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementRead_pkey" PRIMARY KEY ("announcementId","userId")
);

-- CreateTable
CREATE TABLE "HrDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "HrDocumentKind" NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "storagePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "requiresAck" BOOLEAN NOT NULL DEFAULT false,
    "targetUserId" TEXT,
    "publishedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrDocumentAck" (
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "HrDocumentAck_pkey" PRIMARY KEY ("documentId","userId")
);

-- CreateTable
CREATE TABLE "Payslip" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "referenceMonth" INTEGER NOT NULL,
    "referenceYear" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "publishedById" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewedAt" TIMESTAMP(3),

    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayslipQuestion" (
    "id" TEXT NOT NULL,
    "payslipId" TEXT NOT NULL,
    "askedById" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "answer" TEXT,
    "answeredById" TEXT,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayslipQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalCertificate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cid" TEXT,
    "reason" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "days" INTEGER NOT NULL,
    "storagePath" TEXT,
    "fileName" TEXT,
    "status" "CertificateStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "readByWorkerAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicalCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "LeaveKind" NOT NULL DEFAULT 'VACATION',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "days" INTEGER NOT NULL,
    "note" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'REQUESTED',
    "decisionNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Summon" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Summon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SummonAttendance" (
    "summonId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "SummonAttendanceStatus" NOT NULL DEFAULT 'INVITED',
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "SummonAttendance_pkey" PRIMARY KEY ("summonId","userId")
);

-- CreateTable
CREATE TABLE "Training" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GERAL',
    "summary" TEXT,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "points" INTEGER NOT NULL DEFAULT 100,
    "videoUrl" TEXT,
    "validityMonths" INTEGER,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Training_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingSlide" (
    "id" TEXT NOT NULL,
    "trainingId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "imagePath" TEXT,

    CONSTRAINT "TrainingSlide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingQuestion" (
    "id" TEXT NOT NULL,
    "trainingId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correctIndex" INTEGER NOT NULL,

    CONSTRAINT "TrainingQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingEnrollment" (
    "id" TEXT NOT NULL,
    "trainingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "score" INTEGER,
    "certificateCode" TEXT,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "TrainingEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRoleRequirement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobRoleId" TEXT NOT NULL,
    "kind" "RequirementKind" NOT NULL DEFAULT 'CERTIFICATE',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trainingId" TEXT,
    "validityMonths" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobRoleRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerCertificate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requirementId" TEXT,
    "name" TEXT NOT NULL,
    "storagePath" TEXT,
    "fileName" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "status" "CertificateStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OccupationalExam" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ExamKind" NOT NULL DEFAULT 'PERIODIC',
    "performedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "fit" BOOLEAN,
    "storagePath" TEXT,
    "fileName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OccupationalExam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClimateSurvey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT true,
    "status" "SurveyStatus" NOT NULL DEFAULT 'DRAFT',
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClimateSurvey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClimateQuestion" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "factorId" TEXT,

    CONSTRAINT "ClimateQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClimateResponse" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "userId" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClimateResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClimateAnswer" (
    "id" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "score" INTEGER,
    "text" TEXT,

    CONSTRAINT "ClimateAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewCycle" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "SurveyStatus" NOT NULL DEFAULT 'DRAFT',
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewAssignment" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "reviewerUserId" TEXT NOT NULL,
    "revieweeUserId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "ReviewAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewAnswer" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "competency" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,

    CONSTRAINT "ReviewAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "in1" TEXT,
    "out1" TEXT,
    "in2" TEXT,
    "out2" TEXT,
    "balanceMinutes" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PointRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "note" TEXT,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reward" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cost" INTEGER NOT NULL,
    "stock" INTEGER,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardRedemption" (
    "id" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "RedemptionStatus" NOT NULL DEFAULT 'REQUESTED',
    "cost" INTEGER NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "referrerUserId" TEXT NOT NULL,
    "candidateName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "position" TEXT NOT NULL,
    "linkedin" TEXT,
    "note" TEXT,
    "status" "ReferralStatus" NOT NULL DEFAULT 'RECEIVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingStep" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingProgress" (
    "stepId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "doneAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingProgress_pkey" PRIMARY KEY ("stepId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_login_key" ON "User"("login");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Membership_organizationId_role_idx" ON "Membership"("organizationId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_organizationId_key" ON "Membership"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "Account_organizationId_idx" ON "Account"("organizationId");

-- CreateIndex
CREATE INDEX "AccountMembership_accountId_role_idx" ON "AccountMembership"("accountId", "role");

-- CreateIndex
CREATE INDEX "AccountMembership_userId_idx" ON "AccountMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountMembership_accountId_userId_key" ON "AccountMembership"("accountId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountInviteLink_token_key" ON "AccountInviteLink"("token");

-- CreateIndex
CREATE INDEX "AccountInviteLink_accountId_active_idx" ON "AccountInviteLink"("accountId", "active");

-- CreateIndex
CREATE INDEX "AccountJoinRequest_accountId_status_idx" ON "AccountJoinRequest"("accountId", "status");

-- CreateIndex
CREATE INDEX "AccountJoinRequest_email_idx" ON "AccountJoinRequest"("email");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Token_tokenHash_key" ON "Token"("tokenHash");

-- CreateIndex
CREATE INDEX "Token_userId_idx" ON "Token"("userId");

-- CreateIndex
CREATE INDEX "Establishment_organizationId_archivedAt_idx" ON "Establishment"("organizationId", "archivedAt");

-- CreateIndex
CREATE INDEX "Sector_organizationId_archivedAt_idx" ON "Sector"("organizationId", "archivedAt");

-- CreateIndex
CREATE INDEX "Sector_establishmentId_idx" ON "Sector"("establishmentId");

-- CreateIndex
CREATE INDEX "JobRole_organizationId_archivedAt_idx" ON "JobRole"("organizationId", "archivedAt");

-- CreateIndex
CREATE INDEX "JobRole_sectorId_idx" ON "JobRole"("sectorId");

-- CreateIndex
CREATE INDEX "Activity_organizationId_archivedAt_idx" ON "Activity"("organizationId", "archivedAt");

-- CreateIndex
CREATE INDEX "Activity_sectorId_idx" ON "Activity"("sectorId");

-- CreateIndex
CREATE INDEX "ActivityJobRole_jobRoleId_idx" ON "ActivityJobRole"("jobRoleId");

-- CreateIndex
CREATE INDEX "Hazard_organizationId_archivedAt_idx" ON "Hazard"("organizationId", "archivedAt");

-- CreateIndex
CREATE INDEX "Hazard_activityId_idx" ON "Hazard"("activityId");

-- CreateIndex
CREATE INDEX "Risk_organizationId_archivedAt_idx" ON "Risk"("organizationId", "archivedAt");

-- CreateIndex
CREATE INDEX "Risk_hazardId_idx" ON "Risk"("hazardId");

-- CreateIndex
CREATE INDEX "RiskMethodology_organizationId_idx" ON "RiskMethodology"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RiskMethodologyVersion_methodologyId_version_key" ON "RiskMethodologyVersion"("methodologyId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RiskAssessment_supersededById_key" ON "RiskAssessment"("supersededById");

-- CreateIndex
CREATE INDEX "RiskAssessment_organizationId_idx" ON "RiskAssessment"("organizationId");

-- CreateIndex
CREATE INDEX "RiskAssessment_riskId_status_idx" ON "RiskAssessment"("riskId", "status");

-- CreateIndex
CREATE INDEX "ControlMeasure_organizationId_archivedAt_idx" ON "ControlMeasure"("organizationId", "archivedAt");

-- CreateIndex
CREATE INDEX "ControlMeasure_riskId_idx" ON "ControlMeasure"("riskId");

-- CreateIndex
CREATE INDEX "Action_organizationId_status_idx" ON "Action"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Action_assigneeId_status_idx" ON "Action"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "Action_riskId_idx" ON "Action"("riskId");

-- CreateIndex
CREATE INDEX "Evidence_organizationId_idx" ON "Evidence"("organizationId");

-- CreateIndex
CREATE INDEX "Evidence_actionId_idx" ON "Evidence"("actionId");

-- CreateIndex
CREATE INDEX "Evidence_participationId_idx" ON "Evidence"("participationId");

-- CreateIndex
CREATE INDEX "Evidence_occurrenceId_idx" ON "Evidence"("occurrenceId");

-- CreateIndex
CREATE INDEX "ChangeEvent_organizationId_occurredAt_idx" ON "ChangeEvent"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_createdAt_idx" ON "AuditEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "PgrDocument_organizationId_type_issuedAt_idx" ON "PgrDocument"("organizationId", "type", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PgrDocument_organizationId_type_establishmentId_version_key" ON "PgrDocument"("organizationId", "type", "establishmentId", "version");

-- CreateIndex
CREATE INDEX "Aep_organizationId_status_idx" ON "Aep"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Aep_establishmentId_idx" ON "Aep"("establishmentId");

-- CreateIndex
CREATE INDEX "ParticipationRecord_organizationId_occurredAt_idx" ON "ParticipationRecord"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "PreliminarySurvey_organizationId_conductedAt_idx" ON "PreliminarySurvey"("organizationId", "conductedAt");

-- CreateIndex
CREATE INDEX "PreliminarySurveyItem_surveyId_idx" ON "PreliminarySurveyItem"("surveyId");

-- CreateIndex
CREATE INDEX "Occurrence_organizationId_occurredAt_idx" ON "Occurrence"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "EmergencyProcedure_organizationId_archivedAt_idx" ON "EmergencyProcedure"("organizationId", "archivedAt");

-- CreateIndex
CREATE INDEX "EmergencyDrill_procedureId_performedAt_idx" ON "EmergencyDrill"("procedureId", "performedAt");

-- CreateIndex
CREATE INDEX "Contractor_organizationId_archivedAt_idx" ON "Contractor"("organizationId", "archivedAt");

-- CreateIndex
CREATE INDEX "EthicsReport_organizationId_status_idx" ON "EthicsReport"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EthicsReport_organizationId_protocol_key" ON "EthicsReport"("organizationId", "protocol");

-- CreateIndex
CREATE INDEX "EthicsReportMessage_reportId_createdAt_idx" ON "EthicsReportMessage"("reportId", "createdAt");

-- CreateIndex
CREATE INDEX "EmployeeProfile_organizationId_dismissedAt_idx" ON "EmployeeProfile"("organizationId", "dismissedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeProfile_organizationId_taxId_key" ON "EmployeeProfile"("organizationId", "taxId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeProfile_organizationId_registration_key" ON "EmployeeProfile"("organizationId", "registration");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeProfile_organizationId_userId_key" ON "EmployeeProfile"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "Idea_organizationId_status_idx" ON "Idea"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Announcement_organizationId_createdAt_idx" ON "Announcement"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "HrDocument_organizationId_createdAt_idx" ON "HrDocument"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Payslip_organizationId_referenceYear_referenceMonth_idx" ON "Payslip"("organizationId", "referenceYear", "referenceMonth");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_organizationId_userId_referenceYear_referenceMonth_key" ON "Payslip"("organizationId", "userId", "referenceYear", "referenceMonth");

-- CreateIndex
CREATE INDEX "PayslipQuestion_payslipId_idx" ON "PayslipQuestion"("payslipId");

-- CreateIndex
CREATE INDEX "MedicalCertificate_organizationId_status_idx" ON "MedicalCertificate"("organizationId", "status");

-- CreateIndex
CREATE INDEX "LeaveRequest_organizationId_status_idx" ON "LeaveRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Summon_organizationId_scheduledFor_idx" ON "Summon"("organizationId", "scheduledFor");

-- CreateIndex
CREATE INDEX "Training_organizationId_archivedAt_idx" ON "Training"("organizationId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingSlide_trainingId_order_key" ON "TrainingSlide"("trainingId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingQuestion_trainingId_order_key" ON "TrainingQuestion"("trainingId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingEnrollment_certificateCode_key" ON "TrainingEnrollment"("certificateCode");

-- CreateIndex
CREATE INDEX "TrainingEnrollment_userId_status_idx" ON "TrainingEnrollment"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingEnrollment_trainingId_userId_key" ON "TrainingEnrollment"("trainingId", "userId");

-- CreateIndex
CREATE INDEX "JobRoleRequirement_organizationId_jobRoleId_idx" ON "JobRoleRequirement"("organizationId", "jobRoleId");

-- CreateIndex
CREATE INDEX "WorkerCertificate_organizationId_status_idx" ON "WorkerCertificate"("organizationId", "status");

-- CreateIndex
CREATE INDEX "OccupationalExam_organizationId_dueAt_idx" ON "OccupationalExam"("organizationId", "dueAt");

-- CreateIndex
CREATE INDEX "ClimateSurvey_organizationId_status_idx" ON "ClimateSurvey"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClimateQuestion_surveyId_order_key" ON "ClimateQuestion"("surveyId", "order");

-- CreateIndex
CREATE INDEX "ClimateResponse_surveyId_idx" ON "ClimateResponse"("surveyId");

-- CreateIndex
CREATE INDEX "ClimateAnswer_responseId_idx" ON "ClimateAnswer"("responseId");

-- CreateIndex
CREATE INDEX "ReviewCycle_organizationId_status_idx" ON "ReviewCycle"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ReviewAssignment_revieweeUserId_idx" ON "ReviewAssignment"("revieweeUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewAssignment_cycleId_reviewerUserId_revieweeUserId_key" ON "ReviewAssignment"("cycleId", "reviewerUserId", "revieweeUserId");

-- CreateIndex
CREATE INDEX "ReviewAnswer_assignmentId_idx" ON "ReviewAnswer"("assignmentId");

-- CreateIndex
CREATE INDEX "TimeEntry_userId_day_idx" ON "TimeEntry"("userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_organizationId_userId_day_key" ON "TimeEntry"("organizationId", "userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "PointRule_organizationId_activity_key" ON "PointRule"("organizationId", "activity");

-- CreateIndex
CREATE INDEX "PointEntry_organizationId_userId_idx" ON "PointEntry"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "Reward_organizationId_archivedAt_idx" ON "Reward"("organizationId", "archivedAt");

-- CreateIndex
CREATE INDEX "RewardRedemption_rewardId_status_idx" ON "RewardRedemption"("rewardId", "status");

-- CreateIndex
CREATE INDEX "Referral_organizationId_status_idx" ON "Referral"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingStep_organizationId_order_key" ON "OnboardingStep"("organizationId", "order");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountMembership" ADD CONSTRAINT "AccountMembership_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountMembership" ADD CONSTRAINT "AccountMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountInviteLink" ADD CONSTRAINT "AccountInviteLink_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountJoinRequest" ADD CONSTRAINT "AccountJoinRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Establishment" ADD CONSTRAINT "Establishment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sector" ADD CONSTRAINT "Sector_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sector" ADD CONSTRAINT "Sector_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRole" ADD CONSTRAINT "JobRole_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRole" ADD CONSTRAINT "JobRole_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityJobRole" ADD CONSTRAINT "ActivityJobRole_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityJobRole" ADD CONSTRAINT "ActivityJobRole_jobRoleId_fkey" FOREIGN KEY ("jobRoleId") REFERENCES "JobRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hazard" ADD CONSTRAINT "Hazard_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hazard" ADD CONSTRAINT "Hazard_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hazard" ADD CONSTRAINT "Hazard_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hazard" ADD CONSTRAINT "Hazard_aepId_fkey" FOREIGN KEY ("aepId") REFERENCES "Aep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_hazardId_fkey" FOREIGN KEY ("hazardId") REFERENCES "Hazard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskMethodology" ADD CONSTRAINT "RiskMethodology_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskMethodologyVersion" ADD CONSTRAINT "RiskMethodologyVersion_methodologyId_fkey" FOREIGN KEY ("methodologyId") REFERENCES "RiskMethodology"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_methodologyVersionId_fkey" FOREIGN KEY ("methodologyVersionId") REFERENCES "RiskMethodologyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_assessorId_fkey" FOREIGN KEY ("assessorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "RiskAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlMeasure" ADD CONSTRAINT "ControlMeasure_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlMeasure" ADD CONSTRAINT "ControlMeasure_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_changeEventId_fkey" FOREIGN KEY ("changeEventId") REFERENCES "ChangeEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "ControlMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "Occurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_participationId_fkey" FOREIGN KEY ("participationId") REFERENCES "ParticipationRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "Occurrence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_drillId_fkey" FOREIGN KEY ("drillId") REFERENCES "EmergencyDrill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_aepId_fkey" FOREIGN KEY ("aepId") REFERENCES "Aep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeEvent" ADD CONSTRAINT "ChangeEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeEvent" ADD CONSTRAINT "ChangeEvent_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeEvent" ADD CONSTRAINT "ChangeEvent_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgrDocument" ADD CONSTRAINT "PgrDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgrDocument" ADD CONSTRAINT "PgrDocument_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgrDocument" ADD CONSTRAINT "PgrDocument_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aep" ADD CONSTRAINT "Aep_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aep" ADD CONSTRAINT "Aep_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aep" ADD CONSTRAINT "Aep_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aep" ADD CONSTRAINT "Aep_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aep" ADD CONSTRAINT "Aep_conductedById_fkey" FOREIGN KEY ("conductedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipationRecord" ADD CONSTRAINT "ParticipationRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipationRecord" ADD CONSTRAINT "ParticipationRecord_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipationRecord" ADD CONSTRAINT "ParticipationRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreliminarySurvey" ADD CONSTRAINT "PreliminarySurvey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreliminarySurvey" ADD CONSTRAINT "PreliminarySurvey_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreliminarySurvey" ADD CONSTRAINT "PreliminarySurvey_conductedById_fkey" FOREIGN KEY ("conductedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreliminarySurveyItem" ADD CONSTRAINT "PreliminarySurveyItem_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "PreliminarySurvey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreliminarySurveyItem" ADD CONSTRAINT "PreliminarySurveyItem_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_analyzedById_fkey" FOREIGN KEY ("analyzedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyProcedure" ADD CONSTRAINT "EmergencyProcedure_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyProcedure" ADD CONSTRAINT "EmergencyProcedure_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyDrill" ADD CONSTRAINT "EmergencyDrill_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "EmergencyProcedure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyDrill" ADD CONSTRAINT "EmergencyDrill_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contractor" ADD CONSTRAINT "Contractor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contractor" ADD CONSTRAINT "Contractor_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EthicsReport" ADD CONSTRAINT "EthicsReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EthicsReport" ADD CONSTRAINT "EthicsReport_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EthicsReport" ADD CONSTRAINT "EthicsReport_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EthicsReportMessage" ADD CONSTRAINT "EthicsReportMessage_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "EthicsReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EthicsReportMessage" ADD CONSTRAINT "EthicsReportMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_jobRoleId_fkey" FOREIGN KEY ("jobRoleId") REFERENCES "JobRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Idea" ADD CONSTRAINT "Idea_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Idea" ADD CONSTRAINT "Idea_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Idea" ADD CONSTRAINT "Idea_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementRead" ADD CONSTRAINT "AnnouncementRead_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementRead" ADD CONSTRAINT "AnnouncementRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDocument" ADD CONSTRAINT "HrDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDocument" ADD CONSTRAINT "HrDocument_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDocument" ADD CONSTRAINT "HrDocument_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDocumentAck" ADD CONSTRAINT "HrDocumentAck_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "HrDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDocumentAck" ADD CONSTRAINT "HrDocumentAck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipQuestion" ADD CONSTRAINT "PayslipQuestion_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipQuestion" ADD CONSTRAINT "PayslipQuestion_askedById_fkey" FOREIGN KEY ("askedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipQuestion" ADD CONSTRAINT "PayslipQuestion_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalCertificate" ADD CONSTRAINT "MedicalCertificate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalCertificate" ADD CONSTRAINT "MedicalCertificate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalCertificate" ADD CONSTRAINT "MedicalCertificate_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Summon" ADD CONSTRAINT "Summon_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Summon" ADD CONSTRAINT "Summon_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SummonAttendance" ADD CONSTRAINT "SummonAttendance_summonId_fkey" FOREIGN KEY ("summonId") REFERENCES "Summon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SummonAttendance" ADD CONSTRAINT "SummonAttendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Training" ADD CONSTRAINT "Training_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Training" ADD CONSTRAINT "Training_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSlide" ADD CONSTRAINT "TrainingSlide_trainingId_fkey" FOREIGN KEY ("trainingId") REFERENCES "Training"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingQuestion" ADD CONSTRAINT "TrainingQuestion_trainingId_fkey" FOREIGN KEY ("trainingId") REFERENCES "Training"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_trainingId_fkey" FOREIGN KEY ("trainingId") REFERENCES "Training"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRoleRequirement" ADD CONSTRAINT "JobRoleRequirement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRoleRequirement" ADD CONSTRAINT "JobRoleRequirement_jobRoleId_fkey" FOREIGN KEY ("jobRoleId") REFERENCES "JobRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRoleRequirement" ADD CONSTRAINT "JobRoleRequirement_trainingId_fkey" FOREIGN KEY ("trainingId") REFERENCES "Training"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerCertificate" ADD CONSTRAINT "WorkerCertificate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerCertificate" ADD CONSTRAINT "WorkerCertificate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerCertificate" ADD CONSTRAINT "WorkerCertificate_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "JobRoleRequirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerCertificate" ADD CONSTRAINT "WorkerCertificate_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OccupationalExam" ADD CONSTRAINT "OccupationalExam_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OccupationalExam" ADD CONSTRAINT "OccupationalExam_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClimateSurvey" ADD CONSTRAINT "ClimateSurvey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClimateSurvey" ADD CONSTRAINT "ClimateSurvey_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClimateQuestion" ADD CONSTRAINT "ClimateQuestion_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "ClimateSurvey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClimateResponse" ADD CONSTRAINT "ClimateResponse_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "ClimateSurvey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClimateResponse" ADD CONSTRAINT "ClimateResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClimateAnswer" ADD CONSTRAINT "ClimateAnswer_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "ClimateResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClimateAnswer" ADD CONSTRAINT "ClimateAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "ClimateQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCycle" ADD CONSTRAINT "ReviewCycle_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCycle" ADD CONSTRAINT "ReviewCycle_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewAssignment" ADD CONSTRAINT "ReviewAssignment_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ReviewCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewAssignment" ADD CONSTRAINT "ReviewAssignment_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewAssignment" ADD CONSTRAINT "ReviewAssignment_revieweeUserId_fkey" FOREIGN KEY ("revieweeUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewAnswer" ADD CONSTRAINT "ReviewAnswer_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ReviewAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointRule" ADD CONSTRAINT "PointRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointEntry" ADD CONSTRAINT "PointEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointEntry" ADD CONSTRAINT "PointEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointEntry" ADD CONSTRAINT "PointEntry_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "Reward"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerUserId_fkey" FOREIGN KEY ("referrerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingStep" ADD CONSTRAINT "OnboardingStep_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingProgress" ADD CONSTRAINT "OnboardingProgress_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "OnboardingStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingProgress" ADD CONSTRAINT "OnboardingProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

