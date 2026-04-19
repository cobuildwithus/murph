CREATE TYPE "HostedWakeBehavior" AS ENUM ('ordered', 'coalescing');

CREATE TABLE "hosted_execution_cursor" (
    "user_id" TEXT NOT NULL,
    "next_seq" BIGINT NOT NULL DEFAULT 1,
    "committed_seq" BIGINT NOT NULL DEFAULT 0,
    "snapshot_ref" JSONB,
    "version" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_execution_cursor_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "hosted_wake" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "seq" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "behavior" "HostedWakeBehavior" NOT NULL,
    "dedupe_key" TEXT,
    "coalescing_key" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "payload_schema" TEXT NOT NULL,
    "payload_inline_ciphertext" TEXT,
    "payload_ref" TEXT,
    "payload_bytes" INTEGER,
    "quarantined_at" TIMESTAMP(3),
    "quarantine_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_wake_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hosted_wake_user_id_seq_key" ON "hosted_wake"("user_id", "seq");
CREATE UNIQUE INDEX "hosted_wake_dedupe_key_key" ON "hosted_wake"("dedupe_key");
CREATE INDEX "hosted_wake_user_id_seq_idx" ON "hosted_wake"("user_id", "seq");
CREATE INDEX "hosted_wake_user_id_coalescing_key_seq_idx" ON "hosted_wake"("user_id", "coalescing_key", "seq");
CREATE INDEX "hosted_wake_user_id_kind_seq_idx" ON "hosted_wake"("user_id", "kind", "seq");

CREATE TABLE "hosted_wake_payload" (
    "wake_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "payload_ciphertext" TEXT NOT NULL,
    "payload_schema" TEXT NOT NULL,
    "payload_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_wake_payload_pkey" PRIMARY KEY ("wake_id")
);

CREATE INDEX "hosted_wake_payload_user_id_idx" ON "hosted_wake_payload"("user_id");

ALTER TABLE "hosted_execution_cursor"
    ADD CONSTRAINT "hosted_execution_cursor_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hosted_wake"
    ADD CONSTRAINT "hosted_wake_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hosted_wake_payload"
    ADD CONSTRAINT "hosted_wake_payload_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hosted_wake_payload"
    ADD CONSTRAINT "hosted_wake_payload_wake_id_fkey"
    FOREIGN KEY ("wake_id") REFERENCES "hosted_wake"("id") ON DELETE CASCADE ON UPDATE CASCADE;
