ALTER TABLE "hosted_growth_daily_snapshot"
ADD COLUMN "active_users_prior_day" INTEGER,
ADD COLUMN "active_users_trailing_7_days" INTEGER;
