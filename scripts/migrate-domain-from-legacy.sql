-- AUTO-GERADO: migração domínio nr1_db → portal_nr1
-- Identidade (User/Org/Account/…) já migrada; EmployeeProfile.jobRoleId no fim.
\set ON_ERROR_STOP on

SELECT dblink_connect('legacy', 'dbname=nr1_db');

BEGIN;

-- Libera FK JobRole → perfis antes do TRUNCATE do domínio.
UPDATE "EmployeeProfile" SET "jobRoleId" = NULL;

-- DELETE em ordem reversa (TRUNCATE falha com FK de EmployeeProfile→JobRole).
DELETE FROM "Evidence";
DELETE FROM "Action";
DELETE FROM "RiskAssessment";
DELETE FROM "Occurrence";
DELETE FROM "ControlMeasure";
DELETE FROM "Risk";
DELETE FROM "WorkerCertificate";
DELETE FROM "Hazard";
DELETE FROM "JobRoleRequirement";
DELETE FROM "ActivityJobRole";
DELETE FROM "PreliminarySurveyItem";
DELETE FROM "Aep";
DELETE FROM "ReviewAnswer";
DELETE FROM "JobRole";
DELETE FROM "Activity";
DELETE FROM "EthicsReportMessage";
DELETE FROM "EmergencyDrill";
DELETE FROM "ClimateAnswer";
DELETE FROM "TrainingSlide";
DELETE FROM "TrainingQuestion";
DELETE FROM "TrainingEnrollment";
DELETE FROM "SummonAttendance";
DELETE FROM "RiskMethodologyVersion";
DELETE FROM "RewardRedemption";
DELETE FROM "ReviewAssignment";
DELETE FROM "PayslipQuestion";
DELETE FROM "OnboardingProgress";
DELETE FROM "HrDocumentAck";
DELETE FROM "Sector";
DELETE FROM "PreliminarySurvey";
DELETE FROM "PgrDocument";
DELETE FROM "ParticipationRecord";
DELETE FROM "EthicsReport";
DELETE FROM "EmergencyProcedure";
DELETE FROM "Contractor";
DELETE FROM "ChangeEvent";
DELETE FROM "ClimateResponse";
DELETE FROM "ClimateQuestion";
DELETE FROM "AnnouncementRead";
DELETE FROM "Training";
DELETE FROM "TimeEntry";
DELETE FROM "Summon";
DELETE FROM "RiskMethodology";
DELETE FROM "Reward";
DELETE FROM "ReviewCycle";
DELETE FROM "Referral";
DELETE FROM "PointRule";
DELETE FROM "PointEntry";
DELETE FROM "Payslip";
DELETE FROM "OnboardingStep";
DELETE FROM "OccupationalExam";
DELETE FROM "MedicalCertificate";
DELETE FROM "LeaveRequest";
DELETE FROM "Idea";
DELETE FROM "HrDocument";
DELETE FROM "Establishment";
DELETE FROM "ClimateSurvey";
DELETE FROM "AuditEvent";
DELETE FROM "Announcement";

INSERT INTO "Announcement" ("id", "organizationId", "kind", "title", "body", "happensAt", "expiresAt", "publishedById", "createdAt")
SELECT "id", "organizationId", "kind", "title", "body", "happensAt", "expiresAt", "publishedById", "createdAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "kind", "title", "body", "happensAt", "expiresAt", "publishedById", "createdAt" FROM "Announcement"
$q$) AS t("id" text, "organizationId" text, "kind" "AnnouncementKind", "title" text, "body" text, "happensAt" timestamp(3) without time zone, "expiresAt" timestamp(3) without time zone, "publishedById" text, "createdAt" timestamp(3) without time zone);

INSERT INTO "AuditEvent" ("id", "organizationId", "actorId", "action", "entityType", "entityId", "before", "after", "context", "createdAt")
SELECT "id", "organizationId", "actorId", "action", "entityType", "entityId", "before", "after", "context", "createdAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "actorId", "action", "entityType", "entityId", "before", "after", "context", "createdAt" FROM "AuditEvent"
$q$) AS t("id" text, "organizationId" text, "actorId" text, "action" text, "entityType" text, "entityId" text, "before" jsonb, "after" jsonb, "context" jsonb, "createdAt" timestamp(3) without time zone);

INSERT INTO "ClimateSurvey" ("id", "organizationId", "title", "description", "isAnonymous", "status", "opensAt", "closesAt", "createdById", "createdAt")
SELECT "id", "organizationId", "title", "description", "isAnonymous", "status", "opensAt", "closesAt", "createdById", "createdAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "title", "description", "isAnonymous", "status", "opensAt", "closesAt", "createdById", "createdAt" FROM "ClimateSurvey"
$q$) AS t("id" text, "organizationId" text, "title" text, "description" text, "isAnonymous" boolean, "status" "SurveyStatus", "opensAt" timestamp(3) without time zone, "closesAt" timestamp(3) without time zone, "createdById" text, "createdAt" timestamp(3) without time zone);

INSERT INTO "Establishment" ("id", "organizationId", "name", "taxId", "address", "archivedAt", "createdAt", "updatedAt")
SELECT "id", "organizationId", "name", "taxId", "address", "archivedAt", "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "name", "taxId", "address", "archivedAt", "createdAt", "updatedAt" FROM "Establishment"
$q$) AS t("id" text, "organizationId" text, "name" text, "taxId" text, "address" text, "archivedAt" timestamp(3) without time zone, "createdAt" timestamp(3) without time zone, "updatedAt" timestamp(3) without time zone);

INSERT INTO "HrDocument" ("id", "organizationId", "kind", "title", "description", "storagePath", "fileName", "mimeType", "sizeBytes", "requiresAck", "targetUserId", "publishedById", "createdAt")
SELECT "id", "organizationId", "kind", "title", "description", "storagePath", "fileName", "mimeType", "sizeBytes", "requiresAck", "targetUserId", "publishedById", "createdAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "kind", "title", "description", "storagePath", "fileName", "mimeType", "sizeBytes", "requiresAck", "targetUserId", "publishedById", "createdAt" FROM "HrDocument"
$q$) AS t("id" text, "organizationId" text, "kind" "HrDocumentKind", "title" text, "description" text, "storagePath" text, "fileName" text, "mimeType" text, "sizeBytes" integer, "requiresAck" boolean, "targetUserId" text, "publishedById" text, "createdAt" timestamp(3) without time zone);

INSERT INTO "Idea" ("id", "organizationId", "authorUserId", "title", "description", "status", "decisionNote", "decidedById", "decidedAt", "createdAt", "updatedAt")
SELECT "id", "organizationId", "authorUserId", "title", "description", "status", "decisionNote", "decidedById", "decidedAt", "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "authorUserId", "title", "description", "status", "decisionNote", "decidedById", "decidedAt", "createdAt", "updatedAt" FROM "Idea"
$q$) AS t("id" text, "organizationId" text, "authorUserId" text, "title" text, "description" text, "status" "IdeaStatus", "decisionNote" text, "decidedById" text, "decidedAt" timestamp(3) without time zone, "createdAt" timestamp(3) without time zone, "updatedAt" timestamp(3) without time zone);

INSERT INTO "LeaveRequest" ("id", "organizationId", "userId", "kind", "startDate", "endDate", "days", "note", "status", "decisionNote", "decidedById", "decidedAt", "createdAt")
SELECT "id", "organizationId", "userId", "kind", "startDate", "endDate", "days", "note", "status", "decisionNote", "decidedById", "decidedAt", "createdAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "userId", "kind", "startDate", "endDate", "days", "note", "status", "decisionNote", "decidedById", "decidedAt", "createdAt" FROM "LeaveRequest"
$q$) AS t("id" text, "organizationId" text, "userId" text, "kind" "LeaveKind", "startDate" timestamp(3) without time zone, "endDate" timestamp(3) without time zone, "days" integer, "note" text, "status" "LeaveStatus", "decisionNote" text, "decidedById" text, "decidedAt" timestamp(3) without time zone, "createdAt" timestamp(3) without time zone);

INSERT INTO "MedicalCertificate" ("id", "organizationId", "userId", "cid", "reason", "startDate", "days", "storagePath", "fileName", "status", "rejectionReason", "reviewedById", "reviewedAt", "readByWorkerAt", "createdAt")
SELECT "id", "organizationId", "userId", "cid", "reason", "startDate", "days", "storagePath", "fileName", "status", "rejectionReason", "reviewedById", "reviewedAt", "readByWorkerAt", "createdAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "userId", "cid", "reason", "startDate", "days", "storagePath", "fileName", "status", "rejectionReason", "reviewedById", "reviewedAt", "readByWorkerAt", "createdAt" FROM "MedicalCertificate"
$q$) AS t("id" text, "organizationId" text, "userId" text, "cid" text, "reason" text, "startDate" timestamp(3) without time zone, "days" integer, "storagePath" text, "fileName" text, "status" "CertificateStatus", "rejectionReason" text, "reviewedById" text, "reviewedAt" timestamp(3) without time zone, "readByWorkerAt" timestamp(3) without time zone, "createdAt" timestamp(3) without time zone);

INSERT INTO "OccupationalExam" ("id", "organizationId", "userId", "kind", "performedAt", "dueAt", "fit", "storagePath", "fileName", "createdAt", "updatedAt")
SELECT "id", "organizationId", "userId", "kind", "performedAt", "dueAt", "fit", "storagePath", "fileName", "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "userId", "kind", "performedAt", "dueAt", "fit", "storagePath", "fileName", "createdAt", "updatedAt" FROM "OccupationalExam"
$q$) AS t("id" text, "organizationId" text, "userId" text, "kind" "ExamKind", "performedAt" timestamp(3) without time zone, "dueAt" timestamp(3) without time zone, "fit" boolean, "storagePath" text, "fileName" text, "createdAt" timestamp(3) without time zone, "updatedAt" timestamp(3) without time zone);

INSERT INTO "OnboardingStep" ("id", "organizationId", "order", "title", "description", "createdAt")
SELECT "id", "organizationId", "order", "title", "description", "createdAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "order", "title", "description", "createdAt" FROM "OnboardingStep"
$q$) AS t("id" text, "organizationId" text, "order" integer, "title" text, "description" text, "createdAt" timestamp(3) without time zone);

INSERT INTO "Payslip" ("id", "organizationId", "userId", "referenceMonth", "referenceYear", "storagePath", "fileName", "publishedById", "publishedAt", "viewedAt")
SELECT "id", "organizationId", "userId", "referenceMonth", "referenceYear", "storagePath", "fileName", "publishedById", "publishedAt", "viewedAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "userId", "referenceMonth", "referenceYear", "storagePath", "fileName", "publishedById", "publishedAt", "viewedAt" FROM "Payslip"
$q$) AS t("id" text, "organizationId" text, "userId" text, "referenceMonth" integer, "referenceYear" integer, "storagePath" text, "fileName" text, "publishedById" text, "publishedAt" timestamp(3) without time zone, "viewedAt" timestamp(3) without time zone);

INSERT INTO "PointEntry" ("id", "organizationId", "userId", "activity", "points", "note", "grantedById", "createdAt")
SELECT "id", "organizationId", "userId", "activity", "points", "note", "grantedById", "createdAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "userId", "activity", "points", "note", "grantedById", "createdAt" FROM "PointEntry"
$q$) AS t("id" text, "organizationId" text, "userId" text, "activity" text, "points" integer, "note" text, "grantedById" text, "createdAt" timestamp(3) without time zone);

INSERT INTO "PointRule" ("id", "organizationId", "activity", "points", "updatedAt")
SELECT "id", "organizationId", "activity", "points", "updatedAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "activity", "points", "updatedAt" FROM "PointRule"
$q$) AS t("id" text, "organizationId" text, "activity" text, "points" integer, "updatedAt" timestamp(3) without time zone);

INSERT INTO "Referral" ("id", "organizationId", "referrerUserId", "candidateName", "email", "phone", "position", "linkedin", "note", "status", "createdAt", "updatedAt")
SELECT "id", "organizationId", "referrerUserId", "candidateName", "email", "phone", "position", "linkedin", "note", "status", "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "referrerUserId", "candidateName", "email", "phone", "position", "linkedin", "note", "status", "createdAt", "updatedAt" FROM "Referral"
$q$) AS t("id" text, "organizationId" text, "referrerUserId" text, "candidateName" text, "email" text, "phone" text, "position" text, "linkedin" text, "note" text, "status" "ReferralStatus", "createdAt" timestamp(3) without time zone, "updatedAt" timestamp(3) without time zone);

INSERT INTO "ReviewCycle" ("id", "organizationId", "title", "status", "opensAt", "closesAt", "createdById", "createdAt")
SELECT "id", "organizationId", "title", "status", "opensAt", "closesAt", "createdById", "createdAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "title", "status", "opensAt", "closesAt", "createdById", "createdAt" FROM "ReviewCycle"
$q$) AS t("id" text, "organizationId" text, "title" text, "status" "SurveyStatus", "opensAt" timestamp(3) without time zone, "closesAt" timestamp(3) without time zone, "createdById" text, "createdAt" timestamp(3) without time zone);

INSERT INTO "Reward" ("id", "organizationId", "name", "description", "cost", "stock", "archivedAt", "createdAt")
SELECT "id", "organizationId", "name", "description", "cost", "stock", "archivedAt", "createdAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "name", "description", "cost", "stock", "archivedAt", "createdAt" FROM "Reward"
$q$) AS t("id" text, "organizationId" text, "name" text, "description" text, "cost" integer, "stock" integer, "archivedAt" timestamp(3) without time zone, "createdAt" timestamp(3) without time zone);

INSERT INTO "RiskMethodology" ("id", "organizationId", "name", "description", "isDefault", "archivedAt", "createdAt", "updatedAt")
SELECT "id", "organizationId", "name", "description", "isDefault", "archivedAt", "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "name", "description", "isDefault", "archivedAt", "createdAt", "updatedAt" FROM "RiskMethodology"
$q$) AS t("id" text, "organizationId" text, "name" text, "description" text, "isDefault" boolean, "archivedAt" timestamp(3) without time zone, "createdAt" timestamp(3) without time zone, "updatedAt" timestamp(3) without time zone);

INSERT INTO "Summon" ("id", "organizationId", "title", "description", "scheduledFor", "location", "createdById", "createdAt")
SELECT "id", "organizationId", "title", "description", "scheduledFor", "location", "createdById", "createdAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "title", "description", "scheduledFor", "location", "createdById", "createdAt" FROM "Summon"
$q$) AS t("id" text, "organizationId" text, "title" text, "description" text, "scheduledFor" timestamp(3) without time zone, "location" text, "createdById" text, "createdAt" timestamp(3) without time zone);

INSERT INTO "TimeEntry" ("id", "organizationId", "userId", "day", "in1", "out1", "in2", "out2", "balanceMinutes", "note", "createdAt")
SELECT "id", "organizationId", "userId", "day", "in1", "out1", "in2", "out2", "balanceMinutes", "note", "createdAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "userId", "day", "in1", "out1", "in2", "out2", "balanceMinutes", "note", "createdAt" FROM "TimeEntry"
$q$) AS t("id" text, "organizationId" text, "userId" text, "day" timestamp(3) without time zone, "in1" text, "out1" text, "in2" text, "out2" text, "balanceMinutes" integer, "note" text, "createdAt" timestamp(3) without time zone);

INSERT INTO "Training" ("id", "organizationId", "title", "category", "summary", "durationMinutes", "points", "videoUrl", "validityMonths", "archivedAt", "createdById", "createdAt", "updatedAt")
SELECT "id", "organizationId", "title", "category", "summary", "durationMinutes", "points", "videoUrl", "validityMonths", "archivedAt", "createdById", "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "title", "category", "summary", "durationMinutes", "points", "videoUrl", "validityMonths", "archivedAt", "createdById", "createdAt", "updatedAt" FROM "Training"
$q$) AS t("id" text, "organizationId" text, "title" text, "category" text, "summary" text, "durationMinutes" integer, "points" integer, "videoUrl" text, "validityMonths" integer, "archivedAt" timestamp(3) without time zone, "createdById" text, "createdAt" timestamp(3) without time zone, "updatedAt" timestamp(3) without time zone);

INSERT INTO "AnnouncementRead" ("announcementId", "userId", "readAt")
SELECT "announcementId", "userId", "readAt"
FROM dblink('legacy', $q$
  SELECT "announcementId", "userId", "readAt" FROM "AnnouncementRead"
$q$) AS t("announcementId" text, "userId" text, "readAt" timestamp(3) without time zone);

INSERT INTO "ClimateQuestion" ("id", "surveyId", "order", "prompt", "factorId")
SELECT "id", "surveyId", "order", "prompt", "factorId"
FROM dblink('legacy', $q$
  SELECT "id", "surveyId", "order", "prompt", "factorId" FROM "ClimateQuestion"
$q$) AS t("id" text, "surveyId" text, "order" integer, "prompt" text, "factorId" text);

INSERT INTO "ClimateResponse" ("id", "surveyId", "userId", "submittedAt")
SELECT "id", "surveyId", "userId", "submittedAt"
FROM dblink('legacy', $q$
  SELECT "id", "surveyId", "userId", "submittedAt" FROM "ClimateResponse"
$q$) AS t("id" text, "surveyId" text, "userId" text, "submittedAt" timestamp(3) without time zone);

INSERT INTO "ChangeEvent" ("id", "organizationId", "establishmentId", "type", "description", "occurredAt", "reportedById", "createdAt")
SELECT "id", "organizationId", "establishmentId", "type", "description", "occurredAt", "reportedById", "createdAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "establishmentId", "type", "description", "occurredAt", "reportedById", "createdAt" FROM "ChangeEvent"
$q$) AS t("id" text, "organizationId" text, "establishmentId" text, "type" "ChangeEventType", "description" text, "occurredAt" timestamp(3) without time zone, "reportedById" text, "createdAt" timestamp(3) without time zone);

INSERT INTO "Contractor" ("id", "organizationId", "establishmentId", "name", "taxId", "relation", "servicesScope", "documentsReceivedAt", "documentsNotes", "risksInformedAt", "interactionMeasures", "archivedAt", "createdAt", "updatedAt")
SELECT "id", "organizationId", "establishmentId", "name", "taxId", "relation", "servicesScope", "documentsReceivedAt", "documentsNotes", "risksInformedAt", "interactionMeasures", "archivedAt", "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "establishmentId", "name", "taxId", "relation", "servicesScope", "documentsReceivedAt", "documentsNotes", "risksInformedAt", "interactionMeasures", "archivedAt", "createdAt", "updatedAt" FROM "Contractor"
$q$) AS t("id" text, "organizationId" text, "establishmentId" text, "name" text, "taxId" text, "relation" "ContractorRelation", "servicesScope" text, "documentsReceivedAt" timestamp(3) without time zone, "documentsNotes" text, "risksInformedAt" timestamp(3) without time zone, "interactionMeasures" text, "archivedAt" timestamp(3) without time zone, "createdAt" timestamp(3) without time zone, "updatedAt" timestamp(3) without time zone);

INSERT INTO "EmergencyProcedure" ("id", "organizationId", "establishmentId", "scenario", "firstAidMeans", "responsibles", "evacuationPlan", "largeScaleMeasures", "drillFrequencyMonths", "archivedAt", "createdAt", "updatedAt")
SELECT "id", "organizationId", "establishmentId", "scenario", "firstAidMeans", "responsibles", "evacuationPlan", "largeScaleMeasures", "drillFrequencyMonths", "archivedAt", "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "establishmentId", "scenario", "firstAidMeans", "responsibles", "evacuationPlan", "largeScaleMeasures", "drillFrequencyMonths", "archivedAt", "createdAt", "updatedAt" FROM "EmergencyProcedure"
$q$) AS t("id" text, "organizationId" text, "establishmentId" text, "scenario" text, "firstAidMeans" text, "responsibles" text, "evacuationPlan" text, "largeScaleMeasures" text, "drillFrequencyMonths" integer, "archivedAt" timestamp(3) without time zone, "createdAt" timestamp(3) without time zone, "updatedAt" timestamp(3) without time zone);

INSERT INTO "EthicsReport" ("id", "organizationId", "protocol", "category", "description", "isAnonymous", "reporterUserId", "accessCodeHash", "status", "establishmentId", "linkedHazardId", "resolutionNote", "resolvedAt", "createdAt", "updatedAt")
SELECT "id", "organizationId", "protocol", "category", "description", "isAnonymous", "reporterUserId", "accessCodeHash", "status", "establishmentId", "linkedHazardId", "resolutionNote", "resolvedAt", "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "protocol", "category", "description", "isAnonymous", "reporterUserId", "accessCodeHash", "status", "establishmentId", "linkedHazardId", "resolutionNote", "resolvedAt", "createdAt", "updatedAt" FROM "EthicsReport"
$q$) AS t("id" text, "organizationId" text, "protocol" text, "category" "ReportCategory", "description" text, "isAnonymous" boolean, "reporterUserId" text, "accessCodeHash" text, "status" "ReportStatus", "establishmentId" text, "linkedHazardId" text, "resolutionNote" text, "resolvedAt" timestamp(3) without time zone, "createdAt" timestamp(3) without time zone, "updatedAt" timestamp(3) without time zone);

INSERT INTO "ParticipationRecord" ("id", "organizationId", "establishmentId", "type", "subject", "description", "occurredAt", "participantsCount", "recordedById", "createdAt", "updatedAt")
SELECT "id", "organizationId", "establishmentId", "type", "subject", "description", "occurredAt", "participantsCount", "recordedById", "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "establishmentId", "type", "subject", "description", "occurredAt", "participantsCount", "recordedById", "createdAt", "updatedAt" FROM "ParticipationRecord"
$q$) AS t("id" text, "organizationId" text, "establishmentId" text, "type" "ParticipationType", "subject" text, "description" text, "occurredAt" timestamp(3) without time zone, "participantsCount" integer, "recordedById" text, "createdAt" timestamp(3) without time zone, "updatedAt" timestamp(3) without time zone);

INSERT INTO "PgrDocument" ("id", "organizationId", "establishmentId", "type", "version", "content", "issuedAt", "issuedById", "responsibleName", "responsibleRole", "responsibleRegistration", "signatureStatement", "createdAt")
SELECT "id", "organizationId", "establishmentId", "type", "version", "content", "issuedAt", "issuedById", "responsibleName", "responsibleRole", "responsibleRegistration", "signatureStatement", "createdAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "establishmentId", "type", "version", "content", "issuedAt", "issuedById", "responsibleName", "responsibleRole", "responsibleRegistration", "signatureStatement", "createdAt" FROM "PgrDocument"
$q$) AS t("id" text, "organizationId" text, "establishmentId" text, "type" "PgrDocumentType", "version" integer, "content" jsonb, "issuedAt" timestamp(3) without time zone, "issuedById" text, "responsibleName" text, "responsibleRole" text, "responsibleRegistration" text, "signatureStatement" text, "createdAt" timestamp(3) without time zone);

INSERT INTO "PreliminarySurvey" ("id", "organizationId", "establishmentId", "trigger", "description", "conductedById", "conductedAt", "createdAt")
SELECT "id", "organizationId", "establishmentId", "trigger", "description", "conductedById", "conductedAt", "createdAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "establishmentId", "trigger", "description", "conductedById", "conductedAt", "createdAt" FROM "PreliminarySurvey"
$q$) AS t("id" text, "organizationId" text, "establishmentId" text, "trigger" "SurveyTrigger", "description" text, "conductedById" text, "conductedAt" timestamp(3) without time zone, "createdAt" timestamp(3) without time zone);

INSERT INTO "Sector" ("id", "organizationId", "establishmentId", "name", "description", "processDescription", "environmentDescription", "archivedAt", "createdAt", "updatedAt")
SELECT "id", "organizationId", "establishmentId", "name", "description", "processDescription", "environmentDescription", "archivedAt", "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "establishmentId", "name", "description", "processDescription", "environmentDescription", "archivedAt", "createdAt", "updatedAt" FROM "Sector"
$q$) AS t("id" text, "organizationId" text, "establishmentId" text, "name" text, "description" text, "processDescription" text, "environmentDescription" text, "archivedAt" timestamp(3) without time zone, "createdAt" timestamp(3) without time zone, "updatedAt" timestamp(3) without time zone);

INSERT INTO "HrDocumentAck" ("documentId", "userId", "readAt", "acknowledgedAt")
SELECT "documentId", "userId", "readAt", "acknowledgedAt"
FROM dblink('legacy', $q$
  SELECT "documentId", "userId", "readAt", "acknowledgedAt" FROM "HrDocumentAck"
$q$) AS t("documentId" text, "userId" text, "readAt" timestamp(3) without time zone, "acknowledgedAt" timestamp(3) without time zone);

INSERT INTO "OnboardingProgress" ("stepId", "userId", "doneAt")
SELECT "stepId", "userId", "doneAt"
FROM dblink('legacy', $q$
  SELECT "stepId", "userId", "doneAt" FROM "OnboardingProgress"
$q$) AS t("stepId" text, "userId" text, "doneAt" timestamp(3) without time zone);

INSERT INTO "PayslipQuestion" ("id", "payslipId", "askedById", "body", "answer", "answeredById", "answeredAt", "createdAt")
SELECT "id", "payslipId", "askedById", "body", "answer", "answeredById", "answeredAt", "createdAt"
FROM dblink('legacy', $q$
  SELECT "id", "payslipId", "askedById", "body", "answer", "answeredById", "answeredAt", "createdAt" FROM "PayslipQuestion"
$q$) AS t("id" text, "payslipId" text, "askedById" text, "body" text, "answer" text, "answeredById" text, "answeredAt" timestamp(3) without time zone, "createdAt" timestamp(3) without time zone);

INSERT INTO "ReviewAssignment" ("id", "cycleId", "reviewerUserId", "revieweeUserId", "submittedAt")
SELECT "id", "cycleId", "reviewerUserId", "revieweeUserId", "submittedAt"
FROM dblink('legacy', $q$
  SELECT "id", "cycleId", "reviewerUserId", "revieweeUserId", "submittedAt" FROM "ReviewAssignment"
$q$) AS t("id" text, "cycleId" text, "reviewerUserId" text, "revieweeUserId" text, "submittedAt" timestamp(3) without time zone);

INSERT INTO "RewardRedemption" ("id", "rewardId", "userId", "status", "cost", "decidedById", "decidedAt", "createdAt")
SELECT "id", "rewardId", "userId", "status", "cost", "decidedById", "decidedAt", "createdAt"
FROM dblink('legacy', $q$
  SELECT "id", "rewardId", "userId", "status", "cost", "decidedById", "decidedAt", "createdAt" FROM "RewardRedemption"
$q$) AS t("id" text, "rewardId" text, "userId" text, "status" "RedemptionStatus", "cost" integer, "decidedById" text, "decidedAt" timestamp(3) without time zone, "createdAt" timestamp(3) without time zone);

INSERT INTO "RiskMethodologyVersion" ("id", "methodologyId", "version", "severityScale", "probabilityScale", "matrix", "levels", "publishedAt", "createdAt")
SELECT "id", "methodologyId", "version", "severityScale", "probabilityScale", "matrix", "levels", "publishedAt", "createdAt"
FROM dblink('legacy', $q$
  SELECT "id", "methodologyId", "version", "severityScale", "probabilityScale", "matrix", "levels", "publishedAt", "createdAt" FROM "RiskMethodologyVersion"
$q$) AS t("id" text, "methodologyId" text, "version" integer, "severityScale" jsonb, "probabilityScale" jsonb, "matrix" jsonb, "levels" jsonb, "publishedAt" timestamp(3) without time zone, "createdAt" timestamp(3) without time zone);

INSERT INTO "SummonAttendance" ("summonId", "userId", "status", "confirmedAt")
SELECT "summonId", "userId", "status", "confirmedAt"
FROM dblink('legacy', $q$
  SELECT "summonId", "userId", "status", "confirmedAt" FROM "SummonAttendance"
$q$) AS t("summonId" text, "userId" text, "status" "SummonAttendanceStatus", "confirmedAt" timestamp(3) without time zone);

INSERT INTO "TrainingEnrollment" ("id", "trainingId", "userId", "status", "startedAt", "completedAt", "score", "certificateCode", "expiresAt")
SELECT "id", "trainingId", "userId", "status", "startedAt", "completedAt", "score", "certificateCode", "expiresAt"
FROM dblink('legacy', $q$
  SELECT "id", "trainingId", "userId", "status", "startedAt", "completedAt", "score", "certificateCode", "expiresAt" FROM "TrainingEnrollment"
$q$) AS t("id" text, "trainingId" text, "userId" text, "status" "EnrollmentStatus", "startedAt" timestamp(3) without time zone, "completedAt" timestamp(3) without time zone, "score" integer, "certificateCode" text, "expiresAt" timestamp(3) without time zone);

INSERT INTO "TrainingQuestion" ("id", "trainingId", "order", "prompt", "options", "correctIndex")
SELECT "id", "trainingId", "order", "prompt", "options", "correctIndex"
FROM dblink('legacy', $q$
  SELECT "id", "trainingId", "order", "prompt", "options", "correctIndex" FROM "TrainingQuestion"
$q$) AS t("id" text, "trainingId" text, "order" integer, "prompt" text, "options" jsonb, "correctIndex" integer);

INSERT INTO "TrainingSlide" ("id", "trainingId", "order", "title", "body", "imagePath")
SELECT "id", "trainingId", "order", "title", "body", "imagePath"
FROM dblink('legacy', $q$
  SELECT "id", "trainingId", "order", "title", "body", "imagePath" FROM "TrainingSlide"
$q$) AS t("id" text, "trainingId" text, "order" integer, "title" text, "body" text, "imagePath" text);

INSERT INTO "ClimateAnswer" ("id", "responseId", "questionId", "score", "text")
SELECT "id", "responseId", "questionId", "score", "text"
FROM dblink('legacy', $q$
  SELECT "id", "responseId", "questionId", "score", "text" FROM "ClimateAnswer"
$q$) AS t("id" text, "responseId" text, "questionId" text, "score" integer, "text" text);

INSERT INTO "EmergencyDrill" ("id", "procedureId", "performedAt", "participants", "findings", "recordedById", "createdAt")
SELECT "id", "procedureId", "performedAt", "participants", "findings", "recordedById", "createdAt"
FROM dblink('legacy', $q$
  SELECT "id", "procedureId", "performedAt", "participants", "findings", "recordedById", "createdAt" FROM "EmergencyDrill"
$q$) AS t("id" text, "procedureId" text, "performedAt" timestamp(3) without time zone, "participants" integer, "findings" text, "recordedById" text, "createdAt" timestamp(3) without time zone);

INSERT INTO "EthicsReportMessage" ("id", "reportId", "side", "body", "authorUserId", "createdAt", "readByCommitteeAt", "readByReporterAt")
SELECT "id", "reportId", "side", "body", "authorUserId", "createdAt", "readByCommitteeAt", "readByReporterAt"
FROM dblink('legacy', $q$
  SELECT "id", "reportId", "side", "body", "authorUserId", "createdAt", "readByCommitteeAt", "readByReporterAt" FROM "EthicsReportMessage"
$q$) AS t("id" text, "reportId" text, "side" "ReportAuthorSide", "body" text, "authorUserId" text, "createdAt" timestamp(3) without time zone, "readByCommitteeAt" timestamp(3) without time zone, "readByReporterAt" timestamp(3) without time zone);

INSERT INTO "Activity" ("id", "organizationId", "establishmentId", "sectorId", "name", "description", "archivedAt", "createdAt", "updatedAt")
SELECT "id", "organizationId", "establishmentId", "sectorId", "name", "description", "archivedAt", "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "establishmentId", "sectorId", "name", "description", "archivedAt", "createdAt", "updatedAt" FROM "Activity"
$q$) AS t("id" text, "organizationId" text, "establishmentId" text, "sectorId" text, "name" text, "description" text, "archivedAt" timestamp(3) without time zone, "createdAt" timestamp(3) without time zone, "updatedAt" timestamp(3) without time zone);

INSERT INTO "JobRole" ("id", "organizationId", "sectorId", "name", "description", "archivedAt", "createdAt", "updatedAt")
SELECT "id", "organizationId", "sectorId", "name", "description", "archivedAt", "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "sectorId", "name", "description", "archivedAt", "createdAt", "updatedAt" FROM "JobRole"
$q$) AS t("id" text, "organizationId" text, "sectorId" text, "name" text, "description" text, "archivedAt" timestamp(3) without time zone, "createdAt" timestamp(3) without time zone, "updatedAt" timestamp(3) without time zone);

INSERT INTO "ReviewAnswer" ("id", "assignmentId", "competency", "score", "comment")
SELECT "id", "assignmentId", "competency", "score", "comment"
FROM dblink('legacy', $q$
  SELECT "id", "assignmentId", "competency", "score", "comment" FROM "ReviewAnswer"
$q$) AS t("id" text, "assignmentId" text, "competency" text, "score" integer, "comment" text);

INSERT INTO "Aep" ("id", "organizationId", "establishmentId", "sectorId", "activityId", "scopeDescription", "method", "methodRationale", "anonymityMeasures", "workersConsulted", "findings", "status", "conductedById", "conductedAt", "concludedAt", "needsAet", "aetReason", "createdAt", "updatedAt")
SELECT "id", "organizationId", "establishmentId", "sectorId", "activityId", "scopeDescription", "method", "methodRationale", "anonymityMeasures", "workersConsulted", "findings", "status", "conductedById", "conductedAt", "concludedAt", "needsAet", "aetReason", "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "establishmentId", "sectorId", "activityId", "scopeDescription", "method", "methodRationale", "anonymityMeasures", "workersConsulted", "findings", "status", "conductedById", "conductedAt", "concludedAt", "needsAet", "aetReason", "createdAt", "updatedAt" FROM "Aep"
$q$) AS t("id" text, "organizationId" text, "establishmentId" text, "sectorId" text, "activityId" text, "scopeDescription" text, "method" "AepMethod", "methodRationale" text, "anonymityMeasures" text, "workersConsulted" integer, "findings" text, "status" "AepStatus", "conductedById" text, "conductedAt" timestamp(3) without time zone, "concludedAt" timestamp(3) without time zone, "needsAet" boolean, "aetReason" text, "createdAt" timestamp(3) without time zone, "updatedAt" timestamp(3) without time zone);

INSERT INTO "PreliminarySurveyItem" ("id", "surveyId", "activityId", "description", "outcome", "measureTaken", "createdAt")
SELECT "id", "surveyId", "activityId", "description", "outcome", "measureTaken", "createdAt"
FROM dblink('legacy', $q$
  SELECT "id", "surveyId", "activityId", "description", "outcome", "measureTaken", "createdAt" FROM "PreliminarySurveyItem"
$q$) AS t("id" text, "surveyId" text, "activityId" text, "description" text, "outcome" "SurveyOutcome", "measureTaken" text, "createdAt" timestamp(3) without time zone);

INSERT INTO "ActivityJobRole" ("activityId", "jobRoleId", "createdAt")
SELECT "activityId", "jobRoleId", "createdAt"
FROM dblink('legacy', $q$
  SELECT "activityId", "jobRoleId", "createdAt" FROM "ActivityJobRole"
$q$) AS t("activityId" text, "jobRoleId" text, "createdAt" timestamp(3) without time zone);

INSERT INTO "JobRoleRequirement" ("id", "organizationId", "jobRoleId", "kind", "name", "description", "trainingId", "validityMonths", "createdAt")
SELECT "id", "organizationId", "jobRoleId", "kind", "name", "description", "trainingId", "validityMonths", "createdAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "jobRoleId", "kind", "name", "description", "trainingId", "validityMonths", "createdAt" FROM "JobRoleRequirement"
$q$) AS t("id" text, "organizationId" text, "jobRoleId" text, "kind" "RequirementKind", "name" text, "description" text, "trainingId" text, "validityMonths" integer, "createdAt" timestamp(3) without time zone);

INSERT INTO "Hazard" ("id", "organizationId", "activityId", "description", "source", "consequences", "exposedGroup", "exposedWorkersCount", "exposureTime", "exposureFrequency", "exposureIntensity", "monitoringData", "aepId", "category", "status", "origin", "createdById", "archivedAt", "createdAt", "updatedAt")
SELECT "id", "organizationId", "activityId", "description", "source", "consequences", "exposedGroup", "exposedWorkersCount", "exposureTime", "exposureFrequency", "exposureIntensity", "monitoringData", "aepId", "category", "status", "origin", "createdById", "archivedAt", "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "activityId", "description", "source", "consequences", "exposedGroup", "exposedWorkersCount", "exposureTime", "exposureFrequency", "exposureIntensity", "monitoringData", "aepId", "category", "status", "origin", "createdById", "archivedAt", "createdAt", "updatedAt" FROM "Hazard"
$q$) AS t("id" text, "organizationId" text, "activityId" text, "description" text, "source" text, "consequences" text, "exposedGroup" text, "exposedWorkersCount" integer, "exposureTime" text, "exposureFrequency" text, "exposureIntensity" text, "monitoringData" text, "aepId" text, "category" "HazardCategory", "status" "HazardStatus", "origin" "HazardOrigin", "createdById" text, "archivedAt" timestamp(3) without time zone, "createdAt" timestamp(3) without time zone, "updatedAt" timestamp(3) without time zone);

INSERT INTO "WorkerCertificate" ("id", "organizationId", "userId", "requirementId", "name", "storagePath", "fileName", "issuedAt", "expiresAt", "status", "reviewedById", "reviewedAt", "createdAt")
SELECT "id", "organizationId", "userId", "requirementId", "name", "storagePath", "fileName", "issuedAt", "expiresAt", "status", "reviewedById", "reviewedAt", "createdAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "userId", "requirementId", "name", "storagePath", "fileName", "issuedAt", "expiresAt", "status", "reviewedById", "reviewedAt", "createdAt" FROM "WorkerCertificate"
$q$) AS t("id" text, "organizationId" text, "userId" text, "requirementId" text, "name" text, "storagePath" text, "fileName" text, "issuedAt" timestamp(3) without time zone, "expiresAt" timestamp(3) without time zone, "status" "CertificateStatus", "reviewedById" text, "reviewedAt" timestamp(3) without time zone, "createdAt" timestamp(3) without time zone);

INSERT INTO "Risk" ("id", "organizationId", "hazardId", "description", "needsReassessment", "reassessmentReason", "archivedAt", "createdAt", "updatedAt")
SELECT "id", "organizationId", "hazardId", "description", "needsReassessment", "reassessmentReason", "archivedAt", "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "hazardId", "description", "needsReassessment", "reassessmentReason", "archivedAt", "createdAt", "updatedAt" FROM "Risk"
$q$) AS t("id" text, "organizationId" text, "hazardId" text, "description" text, "needsReassessment" boolean, "reassessmentReason" text, "archivedAt" timestamp(3) without time zone, "createdAt" timestamp(3) without time zone, "updatedAt" timestamp(3) without time zone);

INSERT INTO "ControlMeasure" ("id", "organizationId", "riskId", "type", "description", "status", "implementedAt", "effectivenessStatus", "archivedAt", "createdAt", "updatedAt")
SELECT "id", "organizationId", "riskId", "type", "description", "status", "implementedAt", "effectivenessStatus", "archivedAt", "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "riskId", "type", "description", "status", "implementedAt", "effectivenessStatus", "archivedAt", "createdAt", "updatedAt" FROM "ControlMeasure"
$q$) AS t("id" text, "organizationId" text, "riskId" text, "type" "ControlType", "description" text, "status" "ControlStatus", "implementedAt" timestamp(3) without time zone, "effectivenessStatus" text, "archivedAt" timestamp(3) without time zone, "createdAt" timestamp(3) without time zone, "updatedAt" timestamp(3) without time zone);

INSERT INTO "Occurrence" ("id", "organizationId", "establishmentId", "riskId", "type", "occurredAt", "description", "generatingSituation", "organizationalData", "preventionReview", "analyzedById", "analyzedAt", "reportedById", "createdAt", "updatedAt")
SELECT "id", "organizationId", "establishmentId", "riskId", "type", "occurredAt", "description", "generatingSituation", "organizationalData", "preventionReview", "analyzedById", "analyzedAt", "reportedById", "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "establishmentId", "riskId", "type", "occurredAt", "description", "generatingSituation", "organizationalData", "preventionReview", "analyzedById", "analyzedAt", "reportedById", "createdAt", "updatedAt" FROM "Occurrence"
$q$) AS t("id" text, "organizationId" text, "establishmentId" text, "riskId" text, "type" "OccurrenceType", "occurredAt" timestamp(3) without time zone, "description" text, "generatingSituation" text, "organizationalData" text, "preventionReview" text, "analyzedById" text, "analyzedAt" timestamp(3) without time zone, "reportedById" text, "createdAt" timestamp(3) without time zone, "updatedAt" timestamp(3) without time zone);

INSERT INTO "RiskAssessment" ("id", "organizationId", "riskId", "methodologyVersionId", "severity", "probability", "resultingLevel", "severityReason", "probabilityReason", "controlsConsidered", "status", "assessorId", "assessedAt", "expiresAt", "validatedById", "validatedAt", "supersededById", "supersededAt", "createdAt", "updatedAt")
SELECT t."id", t."organizationId", t."riskId", t."methodologyVersionId", t."severity", t."probability", t."resultingLevel", t."severityReason", t."probabilityReason", t."controlsConsidered", t."status", t."assessorId", t."assessedAt", t."expiresAt", t."validatedById", t."validatedAt", NULL, t."supersededAt", t."createdAt", t."updatedAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "riskId", "methodologyVersionId", "severity", "probability", "resultingLevel", "severityReason", "probabilityReason", "controlsConsidered", "status", "assessorId", "assessedAt", "expiresAt", "validatedById", "validatedAt", "supersededAt", "createdAt", "updatedAt" FROM "RiskAssessment"
$q$) AS t("id" text, "organizationId" text, "riskId" text, "methodologyVersionId" text, "severity" integer, "probability" integer, "resultingLevel" text, "severityReason" text, "probabilityReason" text, "controlsConsidered" text, "status" "AssessmentStatus", "assessorId" text, "assessedAt" timestamp(3) without time zone, "expiresAt" timestamp(3) without time zone, "validatedById" text, "validatedAt" timestamp(3) without time zone, "supersededAt" timestamp(3) without time zone, "createdAt" timestamp(3) without time zone, "updatedAt" timestamp(3) without time zone);

INSERT INTO "Action" ("id", "organizationId", "title", "description", "sourceType", "riskId", "changeEventId", "controlId", "occurrenceId", "priority", "status", "assigneeId", "dueDate", "effectivenessCriteria", "effectivenessResult", "createdById", "completedAt", "validatedById", "validatedAt", "rejectionReason", "createdAt", "updatedAt")
SELECT "id", "organizationId", "title", "description", "sourceType", "riskId", "changeEventId", "controlId", "occurrenceId", "priority", "status", "assigneeId", "dueDate", "effectivenessCriteria", "effectivenessResult", "createdById", "completedAt", "validatedById", "validatedAt", "rejectionReason", "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "title", "description", "sourceType", "riskId", "changeEventId", "controlId", "occurrenceId", "priority", "status", "assigneeId", "dueDate", "effectivenessCriteria", "effectivenessResult", "createdById", "completedAt", "validatedById", "validatedAt", "rejectionReason", "createdAt", "updatedAt" FROM "Action"
$q$) AS t("id" text, "organizationId" text, "title" text, "description" text, "sourceType" "ActionSourceType", "riskId" text, "changeEventId" text, "controlId" text, "occurrenceId" text, "priority" "ActionPriority", "status" "ActionStatus", "assigneeId" text, "dueDate" timestamp(3) without time zone, "effectivenessCriteria" text, "effectivenessResult" text, "createdById" text, "completedAt" timestamp(3) without time zone, "validatedById" text, "validatedAt" timestamp(3) without time zone, "rejectionReason" text, "createdAt" timestamp(3) without time zone, "updatedAt" timestamp(3) without time zone);

INSERT INTO "Evidence" ("id", "organizationId", "type", "storagePath", "fileName", "mimeType", "sizeBytes", "description", "eventDate", "uploadedById", "uploadedAt", "validationStatus", "reviewedById", "reviewedAt", "actionId", "participationId", "occurrenceId", "drillId", "aepId", "createdAt", "updatedAt")
SELECT "id", "organizationId", "type", "storagePath", "fileName", "mimeType", "sizeBytes", "description", "eventDate", "uploadedById", "uploadedAt", "validationStatus", "reviewedById", "reviewedAt", "actionId", "participationId", "occurrenceId", "drillId", "aepId", "createdAt", "updatedAt"
FROM dblink('legacy', $q$
  SELECT "id", "organizationId", "type", "storagePath", "fileName", "mimeType", "sizeBytes", "description", "eventDate", "uploadedById", "uploadedAt", "validationStatus", "reviewedById", "reviewedAt", "actionId", "participationId", "occurrenceId", "drillId", "aepId", "createdAt", "updatedAt" FROM "Evidence"
$q$) AS t("id" text, "organizationId" text, "type" "EvidenceType", "storagePath" text, "fileName" text, "mimeType" text, "sizeBytes" integer, "description" text, "eventDate" timestamp(3) without time zone, "uploadedById" text, "uploadedAt" timestamp(3) without time zone, "validationStatus" "EvidenceValidationStatus", "reviewedById" text, "reviewedAt" timestamp(3) without time zone, "actionId" text, "participationId" text, "occurrenceId" text, "drillId" text, "aepId" text, "createdAt" timestamp(3) without time zone, "updatedAt" timestamp(3) without time zone);

-- Self-FK RiskAssessment.supersededById
UPDATE "RiskAssessment" AS r
SET "supersededById" = x."supersededById"
FROM dblink('legacy', $q$
  SELECT id, "supersededById" FROM "RiskAssessment" WHERE "supersededById" IS NOT NULL
$q$) AS x(id text, "supersededById" text)
WHERE r.id = x.id;

-- Religa jobRoleId nos perfis
UPDATE "EmployeeProfile" AS p
SET "jobRoleId" = x."jobRoleId"
FROM dblink('legacy', $q$
  SELECT id, "jobRoleId" FROM "EmployeeProfile" WHERE "jobRoleId" IS NOT NULL
$q$) AS x(id text, "jobRoleId" text)
WHERE p.id = x.id;

COMMIT;

SELECT dblink_disconnect('legacy');

SELECT 'Establishment' AS t, count(*)::int AS c FROM "Establishment"
UNION ALL SELECT 'Sector', count(*)::int FROM "Sector"
UNION ALL SELECT 'JobRole', count(*)::int FROM "JobRole"
UNION ALL SELECT 'Hazard', count(*)::int FROM "Hazard"
UNION ALL SELECT 'Risk', count(*)::int FROM "Risk"
UNION ALL SELECT 'RiskAssessment', count(*)::int FROM "RiskAssessment"
UNION ALL SELECT 'Action', count(*)::int FROM "Action"
UNION ALL SELECT 'EthicsReport', count(*)::int FROM "EthicsReport"
UNION ALL SELECT 'Payslip', count(*)::int FROM "Payslip"
UNION ALL SELECT 'Profiles with job', count(*)::int FROM "EmployeeProfile" WHERE "jobRoleId" IS NOT NULL
UNION ALL SELECT 'User', count(*)::int FROM "User";

