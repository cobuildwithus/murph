CREATE TABLE "health_notification_read" (
  "member_id" TEXT PRIMARY KEY REFERENCES "hosted_member" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "through" TIMESTAMPTZ(3) NOT NULL
);

-- Historical cheers have no event time. Only future inserts inherit the default.
ALTER TABLE "health_working_on_cheer" ADD COLUMN "created_at" TIMESTAMPTZ(3);
ALTER TABLE "health_working_on_cheer" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "health_working_on_cheer_owner_id_created_at_idx" ON "health_working_on_cheer" ("owner_id", "created_at");
CREATE INDEX "health_post_cheer_post_id_created_at_idx" ON "health_post_cheer" ("post_id", "created_at");
