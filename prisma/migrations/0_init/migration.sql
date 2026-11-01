-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "tokenHash" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archetype" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "centerLat" DOUBLE PRECISION NOT NULL,
    "centerLng" DOUBLE PRECISION NOT NULL,
    "aoiKm" DOUBLE PRECISION NOT NULL,
    "incidentTime" TIMESTAMP(3) NOT NULL,
    "severity" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "seed" INTEGER NOT NULL,
    "demoLayer" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetRecord" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "adapterId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "license" TEXT NOT NULL,
    "attribution" TEXT,
    "url" TEXT,
    "checksumSha256" TEXT,
    "sizeBytes" INTEGER,
    "qualityJson" TEXT NOT NULL,
    "geometryJson" TEXT,
    "status" TEXT NOT NULL,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionRun" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "adapterId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "stageLogsJson" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionAttempt" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "ok" BOOLEAN,
    "httpStatus" INTEGER,
    "latencyMs" INTEGER,
    "stage" TEXT,
    "retryable" BOOLEAN,
    "correlationId" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "IngestionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewTask" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "modelConfidence" DOUBLE PRECISION NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "assignedTo" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewDecision" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "newClass" TEXT,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreConfig" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "eventId" TEXT,
    "name" TEXT NOT NULL,
    "weightsJson" TEXT NOT NULL,
    "normalization" TEXT NOT NULL,
    "exposureMethod" TEXT NOT NULL,
    "missingPenalty" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "version" INTEGER NOT NULL,
    "approvedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SitrepDraft" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "claimsJson" TEXT NOT NULL,
    "claimsHash" TEXT NOT NULL,
    "generatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SitrepDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SitrepClaim" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "tool" TEXT NOT NULL,
    "paramsJson" TEXT NOT NULL,
    "valueJson" TEXT NOT NULL,
    "evidenceAssetIds" TEXT NOT NULL,
    "queryHash" TEXT NOT NULL,
    "qualityNote" TEXT,

    CONSTRAINT "SitrepClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SitrepApproval" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "claimsHash" TEXT NOT NULL,
    "reason" TEXT,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SitrepApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportArtifact" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "approvalState" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfflineBundle" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "exportId" TEXT,
    "manifestJson" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfflineBundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "IncidentEvent_orgId_status_idx" ON "IncidentEvent"("orgId", "status");

-- CreateIndex
CREATE INDEX "AssetRecord_eventId_assetType_idx" ON "AssetRecord"("eventId", "assetType");

-- CreateIndex
CREATE INDEX "AssetRecord_eventId_status_idx" ON "AssetRecord"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AssetRecord_eventId_adapterId_externalId_key" ON "AssetRecord"("eventId", "adapterId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "IngestionRun_idempotencyKey_key" ON "IngestionRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "IngestionRun_eventId_adapterId_idx" ON "IngestionRun"("eventId", "adapterId");

-- CreateIndex
CREATE INDEX "IngestionAttempt_runId_idx" ON "IngestionAttempt"("runId");

-- CreateIndex
CREATE INDEX "ReviewTask_eventId_status_idx" ON "ReviewTask"("eventId", "status");

-- CreateIndex
CREATE INDEX "ReviewDecision_taskId_idx" ON "ReviewDecision"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreConfig_orgId_name_version_key" ON "ScoreConfig"("orgId", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SitrepDraft_eventId_version_key" ON "SitrepDraft"("eventId", "version");

-- CreateIndex
CREATE INDEX "SitrepClaim_draftId_idx" ON "SitrepClaim"("draftId");

-- CreateIndex
CREATE INDEX "SitrepApproval_draftId_idx" ON "SitrepApproval"("draftId");

-- CreateIndex
CREATE INDEX "ExportArtifact_eventId_kind_idx" ON "ExportArtifact"("eventId", "kind");

-- CreateIndex
CREATE INDEX "OfflineBundle_eventId_idx" ON "OfflineBundle"("eventId");

-- CreateIndex
CREATE INDEX "AuditEvent_orgId_createdAt_idx" ON "AuditEvent"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_orgId_seq_key" ON "AuditEvent"("orgId", "seq");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentEvent" ADD CONSTRAINT "IncidentEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetRecord" ADD CONSTRAINT "AssetRecord_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "IncidentEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionRun" ADD CONSTRAINT "IngestionRun_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "IncidentEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionAttempt" ADD CONSTRAINT "IngestionAttempt_runId_fkey" FOREIGN KEY ("runId") REFERENCES "IngestionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewTask" ADD CONSTRAINT "ReviewTask_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "IncidentEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ReviewTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreConfig" ADD CONSTRAINT "ScoreConfig_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreConfig" ADD CONSTRAINT "ScoreConfig_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "IncidentEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitrepDraft" ADD CONSTRAINT "SitrepDraft_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "IncidentEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitrepClaim" ADD CONSTRAINT "SitrepClaim_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "SitrepDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitrepApproval" ADD CONSTRAINT "SitrepApproval_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "SitrepDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitrepApproval" ADD CONSTRAINT "SitrepApproval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportArtifact" ADD CONSTRAINT "ExportArtifact_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "IncidentEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfflineBundle" ADD CONSTRAINT "OfflineBundle_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "IncidentEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

