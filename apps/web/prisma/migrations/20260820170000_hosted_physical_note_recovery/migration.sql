CREATE TABLE "hosted_physical_note_recovery" (
  "origin_assistant_input_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "physical_note_id" TEXT,
  "result_status" TEXT,
  "remaining_unresolved" BOOLEAN,
  "retry_after" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_physical_note_recovery_pkey"
    PRIMARY KEY ("origin_assistant_input_id"),
  CONSTRAINT "hosted_physical_note_recovery_result_valid"
    CHECK (
      (
        "result_status" IS NULL
        AND "remaining_unresolved" IS NULL
        AND "retry_after" IS NULL
      )
      OR
      (
        "result_status" IN ('accepted', 'clear', 'pending', 'unavailable')
        AND "remaining_unresolved" IS NOT NULL
        AND ("result_status" = 'pending' OR "retry_after" IS NULL)
      )
    ),
  CONSTRAINT "hosted_physical_note_recovery_member_fkey"
    FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "hosted_physical_note_recovery_note_fkey"
    FOREIGN KEY ("physical_note_id") REFERENCES "hosted_physical_note"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "hosted_physical_note_recovery_member_created_at_idx"
  ON "hosted_physical_note_recovery"("member_id", "created_at");

CREATE INDEX "hosted_physical_note_recovery_physical_note_id_idx"
  ON "hosted_physical_note_recovery"("physical_note_id");
