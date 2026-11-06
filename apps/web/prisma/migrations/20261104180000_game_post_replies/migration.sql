CREATE TABLE "game_reply" (
  "id" TEXT NOT NULL,
  "entry_id" TEXT NOT NULL,
  "author_member_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "text_encrypted" TEXT,
  "audio_encrypted" TEXT,
  "duration_ms" INTEGER,
  "levels" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "game_reply_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "game_reply_content_check" CHECK (
    ("kind" = 'text' AND "text_encrypted" IS NOT NULL AND "audio_encrypted" IS NULL
      AND "duration_ms" IS NULL AND cardinality("levels") = 0)
    OR
    ("kind" = 'voice' AND "text_encrypted" IS NULL AND "audio_encrypted" IS NOT NULL
      AND "duration_ms" IS NOT NULL AND "duration_ms" BETWEEN 1 AND 30500
      AND cardinality("levels") = 32 AND array_ndims("levels") = 1
      AND array_position("levels", NULL) IS NULL
      AND 0 <= ALL("levels") AND 100 >= ALL("levels"))
  ),
  CONSTRAINT "game_reply_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "game_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "game_reply_author_member_id_fkey" FOREIGN KEY ("author_member_id") REFERENCES "game_profile"("member_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "game_reply_entry_id_key" ON "game_reply"("entry_id");
CREATE INDEX "game_reply_author_member_id_idx" ON "game_reply"("author_member_id");

ALTER TABLE "game_report" ADD COLUMN "reply_id" TEXT, ADD COLUMN "snapshot_audio_encrypted" TEXT;
ALTER TABLE "game_report" ADD CONSTRAINT "game_report_reply_id_fkey" FOREIGN KEY ("reply_id") REFERENCES "game_reply"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "game_report_reporter_member_id_reply_id_key" ON "game_report"("reporter_member_id", "reply_id");
CREATE INDEX "game_report_reply_id_idx" ON "game_report"("reply_id");
