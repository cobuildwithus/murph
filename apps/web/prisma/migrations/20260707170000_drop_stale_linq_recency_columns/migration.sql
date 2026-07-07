DROP INDEX IF EXISTS "hosted_member_routing_linq_last_inbound_at_idx";
DROP INDEX IF EXISTS "hosted_member_routing_pending_linq_last_inbound_at_idx";
DROP INDEX IF EXISTS "hosted_thread_route_channel_last_inbound_at_idx";

ALTER TABLE "hosted_member_routing"
  DROP COLUMN IF EXISTS "linq_last_inbound_at",
  DROP COLUMN IF EXISTS "pending_linq_last_inbound_at";

ALTER TABLE "hosted_thread_route"
  DROP COLUMN IF EXISTS "last_inbound_at";
