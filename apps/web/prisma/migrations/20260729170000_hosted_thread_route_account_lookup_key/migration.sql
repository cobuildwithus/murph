ALTER TABLE "hosted_thread_route"
ADD COLUMN "account_lookup_key" TEXT;

CREATE INDEX "hosted_thread_route_channel_account_lookup_key_idx"
ON "hosted_thread_route"("channel", "account_lookup_key");
