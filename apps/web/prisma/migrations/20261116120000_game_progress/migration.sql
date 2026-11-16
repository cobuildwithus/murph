CREATE TABLE "game_progress_award" (
    "member_id" TEXT NOT NULL,
    "lookup" TEXT NOT NULL,
    "subject_member_id" TEXT,
    "earned_on" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data_encrypted" TEXT NOT NULL,
    "seen_at" TIMESTAMP(3),
    CONSTRAINT "game_progress_award_pkey" PRIMARY KEY ("member_id", "lookup")
);
CREATE TABLE "game_progress_measure" (
    "member_id" TEXT NOT NULL,
    "lookup" TEXT NOT NULL,
    "state_encrypted" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "game_progress_measure_pkey" PRIMARY KEY ("member_id", "lookup")
);
CREATE TABLE "game_progress_pic" (
    "id" UUID NOT NULL,
    "member_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "taken_at" TIMESTAMP(3) NOT NULL,
    "meta_encrypted" TEXT NOT NULL,
    "retired_at" TIMESTAMP(3),
    CONSTRAINT "game_progress_pic_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "game_progress_task_measure" (
    "member_id" TEXT NOT NULL,
    "lookup" TEXT NOT NULL,
    "measure_encrypted" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "game_progress_task_measure_pkey" PRIMARY KEY ("member_id", "lookup")
);
CREATE INDEX "game_progress_award_member_id_earned_on_created_at_lookup_idx" ON "game_progress_award"("member_id", "earned_on" DESC, "created_at" DESC, "lookup" DESC);
CREATE INDEX "game_progress_award_subject_member_id_idx" ON "game_progress_award"("subject_member_id");
CREATE UNIQUE INDEX "game_progress_pic_storage_key_key" ON "game_progress_pic"("storage_key");
CREATE INDEX "game_progress_pic_member_id_retired_at_taken_at_idx" ON "game_progress_pic"("member_id", "retired_at", "taken_at");
ALTER TABLE "game_progress_award" ADD CONSTRAINT "game_progress_award_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_progress_award" ADD CONSTRAINT "game_progress_award_subject_member_id_fkey" FOREIGN KEY ("subject_member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_progress_measure" ADD CONSTRAINT "game_progress_measure_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_progress_pic" ADD CONSTRAINT "game_progress_pic_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_progress_task_measure" ADD CONSTRAINT "game_progress_task_measure_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
