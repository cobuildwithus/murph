ALTER TABLE "hosted_member_routing"
  ADD COLUMN "linq_last_inbound_at" TIMESTAMP(3),
  ADD COLUMN "pending_linq_last_inbound_at" TIMESTAMP(3);

CREATE INDEX "hosted_member_routing_linq_last_inbound_at_idx" ON "hosted_member_routing"("linq_last_inbound_at");
CREATE INDEX "hosted_member_routing_pending_linq_last_inbound_at_idx" ON "hosted_member_routing"("pending_linq_last_inbound_at");

ALTER TABLE "hosted_thread_route"
  ADD COLUMN "last_inbound_at" TIMESTAMP(3);

CREATE INDEX "hosted_thread_route_channel_last_inbound_at_idx" ON "hosted_thread_route"("channel", "last_inbound_at");

ALTER TABLE "hosted_linq_delivery"
  ADD COLUMN "skipped_at" TIMESTAMP(3),
  ADD COLUMN "skip_reason" TEXT;
