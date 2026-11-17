CREATE TABLE "game_progress_share" (
    "member_id" TEXT NOT NULL,
    "award_lookup" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failure_code" TEXT,
    CONSTRAINT "game_progress_share_pkey" PRIMARY KEY ("member_id", "award_lookup"),
    CONSTRAINT "game_progress_share_status_check" CHECK ("status" IN ('generating', 'ready', 'failed', 'retired')),
    CONSTRAINT "game_progress_share_failure_code_check" CHECK ("failure_code" IN ('generation_failed', 'timeout', 'refused')),
    CONSTRAINT "game_progress_share_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "game_progress_share_member_id_award_lookup_fkey" FOREIGN KEY ("member_id", "award_lookup") REFERENCES "game_progress_award"("member_id", "lookup") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "game_progress_share_storage_key_key" ON "game_progress_share"("storage_key");
CREATE INDEX "game_progress_share_member_id_created_at_idx" ON "game_progress_share"("member_id", "created_at");
