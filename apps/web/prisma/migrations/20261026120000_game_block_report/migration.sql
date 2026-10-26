-- Report and block for the weekly game (App Store guideline 1.2). A block
-- calls off the pair's open games and hides them from each other until the
-- blocker unblocks. A report keeps a sealed snapshot of what was reported for
-- review, so it outlives the post, the game and the reported account.
-- Additive: older clients never read either table.
-- CreateTable
CREATE TABLE "game_block" (
    "blocker_member_id" TEXT NOT NULL,
    "blocked_member_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_block_pkey" PRIMARY KEY ("blocker_member_id","blocked_member_id")
);

-- CreateTable
CREATE TABLE "game_report" (
    "id" TEXT NOT NULL,
    "reporter_member_id" TEXT NOT NULL,
    "reported_member_id" TEXT,
    "game_id" TEXT,
    "entry_id" TEXT,
    "about" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note_encrypted" TEXT,
    "snapshot_text_encrypted" TEXT,
    "snapshot_media_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "game_block_blocked_member_id_idx" ON "game_block"("blocked_member_id");

-- CreateIndex
CREATE INDEX "game_report_reporter_member_id_created_at_idx" ON "game_report"("reporter_member_id", "created_at");

-- CreateIndex
CREATE INDEX "game_report_reported_member_id_idx" ON "game_report"("reported_member_id");

-- CreateIndex
CREATE INDEX "game_report_game_id_idx" ON "game_report"("game_id");

-- CreateIndex
CREATE INDEX "game_report_entry_id_idx" ON "game_report"("entry_id");

-- CreateIndex
CREATE INDEX "game_report_reviewed_at_created_at_idx" ON "game_report"("reviewed_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "game_report_reporter_member_id_entry_id_key" ON "game_report"("reporter_member_id", "entry_id");

-- AddForeignKey
ALTER TABLE "game_block" ADD CONSTRAINT "game_block_blocker_member_id_fkey" FOREIGN KEY ("blocker_member_id") REFERENCES "game_profile"("member_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_block" ADD CONSTRAINT "game_block_blocked_member_id_fkey" FOREIGN KEY ("blocked_member_id") REFERENCES "game_profile"("member_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_report" ADD CONSTRAINT "game_report_reporter_member_id_fkey" FOREIGN KEY ("reporter_member_id") REFERENCES "game_profile"("member_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_report" ADD CONSTRAINT "game_report_reported_member_id_fkey" FOREIGN KEY ("reported_member_id") REFERENCES "game_profile"("member_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_report" ADD CONSTRAINT "game_report_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "game"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_report" ADD CONSTRAINT "game_report_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "game_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

