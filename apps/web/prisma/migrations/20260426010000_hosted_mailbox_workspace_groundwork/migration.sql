-- CreateTable
CREATE TABLE "hosted_mailbox_item" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "lane" TEXT NOT NULL,
    "lane_seq" BIGINT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "payload_schema" TEXT NOT NULL,
    "payload_inline_ciphertext" TEXT,
    "payload_ref" TEXT,
    "payload_bytes" INTEGER,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_mailbox_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hosted_mailbox_payload" (
    "mailbox_item_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "payload_ciphertext" TEXT NOT NULL,
    "payload_schema" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hosted_mailbox_payload_pkey" PRIMARY KEY ("mailbox_item_id")
);

-- CreateTable
CREATE TABLE "hosted_mailbox_lane_counter" (
    "user_id" TEXT NOT NULL,
    "lane" TEXT NOT NULL,
    "next_seq" BIGINT NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_mailbox_lane_counter_pkey" PRIMARY KEY ("user_id","lane")
);

-- CreateTable
CREATE TABLE "hosted_workspace" (
    "user_id" TEXT NOT NULL,
    "version" BIGINT NOT NULL DEFAULT 0,
    "snapshot_ref" JSONB,
    "browser_vault_replica_ref" JSONB,
    "next_wake_at" TIMESTAMP(3),
    "next_wake_reason" TEXT,
    "redacted_status_json" JSONB,
    "checkpointed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_workspace_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "hosted_runtime_log" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "level" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "event_code" TEXT NOT NULL,
    "attempt_id" TEXT,
    "lease_generation" BIGINT,
    "workspace_version" BIGINT,
    "checkpoint_version" BIGINT,
    "mailbox_lane" TEXT,
    "mailbox_seq_start" BIGINT,
    "mailbox_seq_end" BIGINT,
    "outbox_intent_ref" TEXT,
    "error_code" TEXT,
    "redacted_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hosted_runtime_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hosted_mailbox_item_user_id_lane_lane_seq_key" ON "hosted_mailbox_item"("user_id", "lane", "lane_seq");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_mailbox_item_user_id_dedupe_key_key" ON "hosted_mailbox_item"("user_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "hosted_mailbox_item_user_id_lane_lane_seq_idx" ON "hosted_mailbox_item"("user_id", "lane", "lane_seq");

-- CreateIndex
CREATE INDEX "hosted_mailbox_item_user_id_kind_created_at_idx" ON "hosted_mailbox_item"("user_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "hosted_mailbox_item_user_id_expires_at_idx" ON "hosted_mailbox_item"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "hosted_mailbox_payload_user_id_created_at_idx" ON "hosted_mailbox_payload"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "hosted_runtime_log_user_id_at_idx" ON "hosted_runtime_log"("user_id", "at");

-- CreateIndex
CREATE INDEX "hosted_runtime_log_level_at_idx" ON "hosted_runtime_log"("level", "at");

-- CreateIndex
CREATE INDEX "hosted_runtime_log_component_at_idx" ON "hosted_runtime_log"("component", "at");

-- AddForeignKey
ALTER TABLE "hosted_mailbox_item" ADD CONSTRAINT "hosted_mailbox_item_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_mailbox_payload" ADD CONSTRAINT "hosted_mailbox_payload_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_mailbox_payload" ADD CONSTRAINT "hosted_mailbox_payload_mailbox_item_id_fkey" FOREIGN KEY ("mailbox_item_id") REFERENCES "hosted_mailbox_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_mailbox_lane_counter" ADD CONSTRAINT "hosted_mailbox_lane_counter_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_workspace" ADD CONSTRAINT "hosted_workspace_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_runtime_log" ADD CONSTRAINT "hosted_runtime_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
