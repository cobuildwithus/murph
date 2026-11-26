-- The encrypted summary holds the recording. The remaining fields identify its
-- owner, local day, publication binding and lifecycle.
CREATE TABLE "health_activity" (
    "id" UUID PRIMARY KEY,
    "member_id" TEXT NOT NULL REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "day" VARCHAR(10) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "post_id" UUID REFERENCES "health_post"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "deleted_at" TIMESTAMPTZ(3),
    "summary_encrypted" TEXT NOT NULL
);
CREATE UNIQUE INDEX "health_activity_post_id_key" ON "health_activity"("post_id");
CREATE INDEX "health_activity_member_id_day_id_idx" ON "health_activity"("member_id", "day", "id");
