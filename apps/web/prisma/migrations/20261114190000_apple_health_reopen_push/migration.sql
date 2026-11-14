-- null: the app build holding this route has not reported its "Reopen
-- reminders" switch. The server treats that as on.
ALTER TABLE "companion_push_route" ADD COLUMN "reopen_reminders" BOOLEAN;

-- One row per reopen push claimed for a member. The key is the idempotency
-- key: one push per member, silence episode and schedule step.
CREATE TABLE "apple_health_reopen_push" (
    "user_id" TEXT NOT NULL,
    "episode_started_at" TIMESTAMP(3) NOT NULL,
    "step" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "apple_health_reopen_push_pkey" PRIMARY KEY ("user_id", "episode_started_at", "step"),
    CONSTRAINT "apple_health_reopen_push_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
