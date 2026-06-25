-- CreateEnum
CREATE TYPE "HostedPhoneCallStatus" AS ENUM ('starting', 'calling', 'ended', 'completed', 'needs_user', 'failed');

-- CreateTable
CREATE TABLE "hosted_phone_call" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "request_key" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'retell',
    "provider_call_id" TEXT,
    "status" "HostedPhoneCallStatus" NOT NULL DEFAULT 'starting',
    "brief_json" JSONB NOT NULL,
    "result_json" JSONB,
    "ended_at" TIMESTAMP(3),
    "analyzed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_phone_call_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hosted_phone_call_request_key_key" ON "hosted_phone_call"("request_key");
CREATE UNIQUE INDEX "hosted_phone_call_provider_call_id_key" ON "hosted_phone_call"("provider_call_id");
CREATE INDEX "hosted_phone_call_member_id_created_at_idx" ON "hosted_phone_call"("member_id", "created_at");
CREATE INDEX "hosted_phone_call_status_updated_at_idx" ON "hosted_phone_call"("status", "updated_at");

-- AddForeignKey
ALTER TABLE "hosted_phone_call" ADD CONSTRAINT "hosted_phone_call_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
