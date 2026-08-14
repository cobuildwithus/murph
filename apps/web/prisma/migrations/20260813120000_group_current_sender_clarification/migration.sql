CREATE TABLE "hosted_group_current_sender_clarification" (
  "group_runtime_member_id" TEXT NOT NULL,
  "target_member_id" TEXT NOT NULL,
  "origin_assistant_input_id" TEXT NOT NULL,
  "origin_session_id" TEXT NOT NULL,
  "source_causal_seq" BIGINT NOT NULL,
  "resolved_by_assistant_input_id" TEXT,
  "resolved_audience" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_group_current_sender_clarification_pkey"
    PRIMARY KEY ("group_runtime_member_id", "target_member_id"),
  CONSTRAINT "hosted_group_current_sender_clarification_origin_key"
    UNIQUE ("origin_assistant_input_id"),
  CONSTRAINT "hosted_group_current_sender_clarification_source_order_valid"
    CHECK ("source_causal_seq" > 0),
  CONSTRAINT "hosted_group_current_sender_clarification_resolution_valid"
    CHECK (
      ("resolved_by_assistant_input_id" IS NULL AND "resolved_audience" IS NULL)
      OR
      (
        "resolved_by_assistant_input_id" IS NOT NULL
        AND "resolved_audience" IN ('group', 'current_sender')
      )
    ),
  CONSTRAINT "hosted_group_current_sender_clarification_runtime_fkey"
    FOREIGN KEY ("group_runtime_member_id") REFERENCES "hosted_member"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "hosted_group_current_sender_clarification_target_fkey"
    FOREIGN KEY ("target_member_id") REFERENCES "hosted_member"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "hosted_group_current_sender_clarification_expiry_idx"
  ON "hosted_group_current_sender_clarification"("expires_at");
