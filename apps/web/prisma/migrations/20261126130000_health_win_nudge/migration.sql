CREATE TABLE "health_win_nudge" (
  "member_id" TEXT PRIMARY KEY REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "seen_version" TEXT,
  "seen_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "baseline_at" TIMESTAMPTZ(3),
  "last_presented_at" TIMESTAMPTZ(3) NOT NULL,
  "last_evaluated_day" VARCHAR(10)
);
