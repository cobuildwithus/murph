-- CreateTable
CREATE TABLE "hosted_consent_event" (
  "id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "document_versions_json" JSONB NOT NULL,
  "source" TEXT NOT NULL,
  "metadata_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "hosted_consent_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hosted_consent_grant" (
  "member_id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'granted',
  "document_versions_json" JSONB NOT NULL,
  "source" TEXT NOT NULL,
  "granted_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "last_event_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_consent_grant_pkey" PRIMARY KEY ("member_id", "scope")
);

-- CreateIndex
CREATE INDEX "hosted_consent_event_member_id_created_at_idx" ON "hosted_consent_event"("member_id", "created_at");

-- CreateIndex
CREATE INDEX "hosted_consent_event_member_id_scope_created_at_idx" ON "hosted_consent_event"("member_id", "scope", "created_at");

-- CreateIndex
CREATE INDEX "hosted_consent_grant_member_id_status_idx" ON "hosted_consent_grant"("member_id", "status");

-- CreateIndex
CREATE INDEX "hosted_consent_grant_scope_status_idx" ON "hosted_consent_grant"("scope", "status");

-- AddForeignKey
ALTER TABLE "hosted_consent_event" ADD CONSTRAINT "hosted_consent_event_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_consent_grant" ADD CONSTRAINT "hosted_consent_grant_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
