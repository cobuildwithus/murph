ALTER TABLE "hosted_member_routing"
  ADD COLUMN "linq_home_line_assigned_at" TIMESTAMP(3);

ALTER TABLE "hosted_linq_line"
  ADD COLUMN "phone_number_encrypted" TEXT,
  ADD COLUMN "provider_phone_number_id" TEXT,
  ADD COLUMN "provider_first_seen_at" TIMESTAMP(3),
  ADD COLUMN "provider_last_seen_at" TIMESTAMP(3);

CREATE INDEX "hosted_member_routing_linq_recipient_assigned_at_idx"
  ON "hosted_member_routing"("linq_recipient_phone_lookup_key", "linq_home_line_assigned_at");

CREATE UNIQUE INDEX "hosted_linq_line_provider_phone_number_id_key"
  ON "hosted_linq_line"("provider_phone_number_id");

CREATE INDEX "hosted_linq_line_configured_egress_health_idx"
  ON "hosted_linq_line"("configured_at", "egress_policy", "health_status");

CREATE INDEX "hosted_linq_line_provider_last_seen_at_idx"
  ON "hosted_linq_line"("provider_last_seen_at");
