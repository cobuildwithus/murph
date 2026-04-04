CREATE TABLE "hosted_linq_daily_state" (
    "member_id" TEXT NOT NULL,
    "day_utc" TIMESTAMP(3) NOT NULL,
    "inbound_count" INTEGER NOT NULL DEFAULT 0,
    "outbound_count" INTEGER NOT NULL DEFAULT 0,
    "onboarding_link_sent_at" TIMESTAMP(3),
    "quota_reply_sent_at" TIMESTAMP(3),
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_linq_daily_state_pkey" PRIMARY KEY ("member_id","day_utc")
);

CREATE INDEX "hosted_linq_daily_state_day_utc_idx" ON "hosted_linq_daily_state"("day_utc");

ALTER TABLE "hosted_linq_daily_state"
ADD CONSTRAINT "hosted_linq_daily_state_member_id_fkey"
FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
