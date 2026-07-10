ALTER TABLE "hosted_group_join_offer"
  ALTER COLUMN "message_lookup_key" DROP NOT NULL,
  ADD COLUMN "binding_attempted_at" TIMESTAMP(3);
