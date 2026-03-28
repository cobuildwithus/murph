ALTER TABLE "hosted_member"
  ADD COLUMN "telegram_user_id" TEXT,
  ADD COLUMN "telegram_username" TEXT;

CREATE UNIQUE INDEX "hosted_member_telegram_user_id_key"
  ON "hosted_member" ("telegram_user_id");
