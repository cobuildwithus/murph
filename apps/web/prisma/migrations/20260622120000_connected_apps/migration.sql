-- CreateTable
CREATE TABLE "hosted_connected_apps_session" (
    "member_id" TEXT NOT NULL,
    "remote_session_id" TEXT NOT NULL,
    "policy_revision" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hosted_connected_apps_session_pkey" PRIMARY KEY ("member_id")
);

-- CreateTable
CREATE TABLE "hosted_connected_app_connect_intent" (
    "claim_hash" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "toolkit" TEXT NOT NULL,
    "alias" TEXT,
    "connected_account_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "hosted_connected_app_connect_intent_pkey" PRIMARY KEY ("claim_hash")
);

-- CreateIndex
CREATE UNIQUE INDEX "hosted_connected_apps_session_remote_session_id_key"
ON "hosted_connected_apps_session"("remote_session_id");

-- CreateIndex
CREATE INDEX "hosted_connected_app_connect_intent_expires_at_idx"
ON "hosted_connected_app_connect_intent"("expires_at");

-- CreateIndex
CREATE INDEX "hosted_connected_app_connect_intent_member_id_expires_at_idx"
ON "hosted_connected_app_connect_intent"("member_id", "expires_at");

-- CreateIndex
CREATE INDEX "hosted_connected_app_connect_intent_started_at_idx"
ON "hosted_connected_app_connect_intent"("started_at");

-- CreateIndex
CREATE INDEX "hosted_connected_app_connect_intent_completed_at_idx"
ON "hosted_connected_app_connect_intent"("completed_at");

-- AddForeignKey
ALTER TABLE "hosted_connected_apps_session"
ADD CONSTRAINT "hosted_connected_apps_session_member_id_fkey"
FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_connected_app_connect_intent"
ADD CONSTRAINT "hosted_connected_app_connect_intent_member_id_fkey"
FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
