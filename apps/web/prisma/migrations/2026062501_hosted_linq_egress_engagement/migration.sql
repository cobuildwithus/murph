ALTER TABLE "hosted_member_routing"
  ADD COLUMN "linq_last_inbound_at" TIMESTAMP(3),
  ADD COLUMN "pending_linq_last_inbound_at" TIMESTAMP(3);

-- Existing Linq chat bindings were created before the freshness projection
-- existed. Initialize them at rollout so the new guard does not fail closed
-- until future inbound webhooks advance these fields with provider times.
UPDATE "hosted_member_routing"
SET "linq_last_inbound_at" = CURRENT_TIMESTAMP
WHERE "linq_chat_lookup_key" IS NOT NULL
  AND "linq_last_inbound_at" IS NULL;

UPDATE "hosted_member_routing"
SET "pending_linq_last_inbound_at" = CURRENT_TIMESTAMP
WHERE "pending_linq_chat_lookup_key" IS NOT NULL
  AND "pending_linq_last_inbound_at" IS NULL;

CREATE INDEX "hosted_member_routing_linq_last_inbound_at_idx" ON "hosted_member_routing"("linq_last_inbound_at");
CREATE INDEX "hosted_member_routing_pending_linq_last_inbound_at_idx" ON "hosted_member_routing"("pending_linq_last_inbound_at");

ALTER TABLE "hosted_thread_route"
  ADD COLUMN "last_inbound_at" TIMESTAMP(3);

UPDATE "hosted_thread_route"
SET "last_inbound_at" = CURRENT_TIMESTAMP
WHERE "channel" = 'linq'
  AND "last_inbound_at" IS NULL;

CREATE INDEX "hosted_thread_route_channel_last_inbound_at_idx" ON "hosted_thread_route"("channel", "last_inbound_at");
