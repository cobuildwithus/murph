CREATE TYPE "HostedComputerRunStatus" AS ENUM (
  'running',
  'awaiting_user',
  'completed',
  'failed',
  'expired',
  'canceled'
);

CREATE TYPE "HostedComputerAwaitingReason" AS ENUM (
  'login_needed',
  'payment_needed',
  'final_confirmation',
  'stuck',
  'other'
);

CREATE TYPE "HostedComputerHandoffStatus" AS ENUM (
  'open',
  'checkpointing',
  'completed',
  'expired',
  'revoked'
);

CREATE TABLE "hosted_computer_run" (
  "id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "profile_key" TEXT NOT NULL,
  "kernel_profile_name" TEXT NOT NULL,
  "last_checkpoint_at" TIMESTAMP(3),
  "last_authenticated_at" TIMESTAMP(3),
  "status" "HostedComputerRunStatus" NOT NULL DEFAULT 'running',
  "kernel_session_id" TEXT,
  "kernel_live_view_url_encrypted" TEXT,
  "last_url" TEXT,
  "last_title" TEXT,
  "awaiting_reason" "HostedComputerAwaitingReason",
  "awaiting_message" TEXT,
  "suggested_reply" TEXT,
  "paused_at" TIMESTAMP(3),
  "resumed_at" TIMESTAMP(3),
  "pending_handoff_id" TEXT,
  "metadata_json" JSONB,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),

  CONSTRAINT "hosted_computer_run_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hosted_computer_run_member_id_fkey"
    FOREIGN KEY ("member_id")
    REFERENCES "hosted_member"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE TABLE "hosted_computer_handoff" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "status" "HostedComputerHandoffStatus" NOT NULL DEFAULT 'open',
  "suggested_reply" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "opened_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_computer_handoff_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hosted_computer_handoff_member_id_fkey"
    FOREIGN KEY ("member_id")
    REFERENCES "hosted_member"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "hosted_computer_handoff_run_id_fkey"
    FOREIGN KEY ("run_id")
    REFERENCES "hosted_computer_run"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX "hosted_computer_run_member_id_status_updated_at_idx"
  ON "hosted_computer_run"("member_id", "status", "updated_at");

CREATE INDEX "hosted_computer_run_member_id_awaiting_reason_updated_at_idx"
  ON "hosted_computer_run"("member_id", "awaiting_reason", "updated_at");

CREATE INDEX "hosted_computer_run_member_id_profile_key_updated_at_idx"
  ON "hosted_computer_run"("member_id", "profile_key", "updated_at");

CREATE INDEX "hosted_computer_run_status_expires_at_idx"
  ON "hosted_computer_run"("status", "expires_at");

CREATE UNIQUE INDEX "hosted_computer_run_one_active_profile_idx"
  ON "hosted_computer_run"("member_id", "profile_key")
  WHERE "status" IN ('running', 'awaiting_user');

CREATE UNIQUE INDEX "hosted_computer_handoff_token_hash_key"
  ON "hosted_computer_handoff"("token_hash");

CREATE INDEX "hosted_computer_handoff_member_id_status_expires_at_idx"
  ON "hosted_computer_handoff"("member_id", "status", "expires_at");

CREATE INDEX "hosted_computer_handoff_run_id_status_idx"
  ON "hosted_computer_handoff"("run_id", "status");

CREATE INDEX "hosted_computer_handoff_expires_at_idx"
  ON "hosted_computer_handoff"("expires_at");
