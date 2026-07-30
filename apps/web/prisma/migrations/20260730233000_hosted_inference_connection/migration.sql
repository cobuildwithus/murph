BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE "hosted_inference_connection" (
  "member_id" TEXT NOT NULL,
  "protocol" TEXT NOT NULL,
  "config_encrypted" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "context_window_tokens" INTEGER NOT NULL,
  "supports_images" BOOLEAN NOT NULL DEFAULT false,
  "verification_profile" TEXT NOT NULL,
  "verified_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_inference_connection_pkey" PRIMARY KEY ("member_id"),
  CONSTRAINT "hosted_inference_connection_protocol_valid"
    CHECK ("protocol" IN ('responses', 'chat_completions')),
  CONSTRAINT "hosted_inference_connection_revision_valid"
    CHECK ("revision" >= 1),
  CONSTRAINT "hosted_inference_connection_context_window_valid"
    CHECK ("context_window_tokens" BETWEEN 8192 AND 2000000),
  CONSTRAINT "hosted_inference_connection_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

COMMIT;
