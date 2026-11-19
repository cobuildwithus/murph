-- Change photo: an award can have more than one picture attempt. The attempt's storage key, already unique, becomes its identity.
-- Live code reads and writes share rows by column, and a second attempt can only come from the next app build.
ALTER TABLE "game_progress_share" DROP CONSTRAINT "game_progress_share_pkey";
ALTER TABLE "game_progress_share" ADD CONSTRAINT "game_progress_share_pkey" PRIMARY KEY USING INDEX "game_progress_share_storage_key_key";
CREATE INDEX "game_progress_share_member_id_award_lookup_created_at_idx" ON "game_progress_share"("member_id", "award_lookup", "created_at");

-- The medal photo: one sealed copy per pick. Rows outlive their bytes so a failed purge replays.
CREATE TABLE "game_progress_share_photo" (
    "storage_key" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "game_progress_share_photo_pkey" PRIMARY KEY ("storage_key"),
    CONSTRAINT "game_progress_share_photo_status_check" CHECK ("status" IN ('pending', 'current', 'retired')),
    CONSTRAINT "game_progress_share_photo_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "game_progress_share_photo_member_id_status_idx" ON "game_progress_share_photo"("member_id", "status");
