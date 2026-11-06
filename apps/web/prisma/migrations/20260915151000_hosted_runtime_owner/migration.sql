CREATE TABLE "hosted_runtime_owner" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "generation" BIGINT NOT NULL DEFAULT 0 CHECK (generation >= 0),
    "attempt_id" TEXT,
    "phase" TEXT NOT NULL DEFAULT 'idle' CHECK (phase IN ('idle', 'starting', 'active', 'retiring')),
    "processing_mode" TEXT CHECK (processing_mode IN ('default', 'system_mailbox', 'inbox_media_retention')),
    "allocation_id" TEXT,
    "runner_container_name" TEXT,
    "workspace_version" BIGINT CHECK (workspace_version >= 0),
    "provider_egress_token_hash" TEXT,
    "custom_inference_envelope" TEXT,
    "platform_ai_usage_allowed" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "failure_count" INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    "last_error_code" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hosted_runtime_owner_attempt_shape" CHECK (
      (phase = 'idle' AND attempt_id IS NULL AND (
        (allocation_id IS NULL AND runner_container_name IS NULL)
        OR (allocation_id IS NOT NULL AND runner_container_name IS NOT NULL)
      ))
      OR (phase <> 'idle' AND attempt_id IS NOT NULL AND allocation_id IS NOT NULL AND processing_mode IS NOT NULL)
    ),
    CONSTRAINT "hosted_runtime_owner_active_target" CHECK (
      phase <> 'active' OR (runner_container_name IS NOT NULL AND workspace_version IS NOT NULL)
    )
);

CREATE TABLE "hosted_runtime_cutover" (
    "id" TEXT NOT NULL PRIMARY KEY CHECK (id = 'runtime'),
    "phase" TEXT NOT NULL DEFAULT 'legacy' CHECK (phase IN ('legacy', 'draining', 'postgres')),
    "updated_at" TIMESTAMP(3) NOT NULL
);
INSERT INTO "hosted_runtime_cutover" (id, phase, updated_at) VALUES ('runtime', 'legacy', CURRENT_TIMESTAMP);
