CREATE TABLE "hosted_pending_group_setup" (
  "id" TEXT NOT NULL,
  "owner_member_id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "recipient_phone_lookup_key" TEXT NOT NULL,
  "payload_encrypted" TEXT NOT NULL,
  "armed_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_pending_group_setup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hosted_pending_group_setup_owner_member_key"
    UNIQUE ("owner_member_id"),
  CONSTRAINT "hosted_pending_group_setup_channel_valid"
    CHECK ("channel" = 'linq'),
  CONSTRAINT "hosted_pending_group_setup_window_valid"
    CHECK ("expires_at" > "armed_at"),
  CONSTRAINT "hosted_pending_group_setup_recipient_key_present"
    CHECK (length("recipient_phone_lookup_key") > 0),
  CONSTRAINT "hosted_pending_group_setup_payload_present"
    CHECK (length("payload_encrypted") > 0),
  CONSTRAINT "hosted_pending_group_setup_owner_member_id_fkey"
    FOREIGN KEY ("owner_member_id") REFERENCES "hosted_member"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "hosted_pending_group_setup_match_idx"
  ON "hosted_pending_group_setup"(
    "channel",
    "recipient_phone_lookup_key",
    "expires_at",
    "owner_member_id"
  );

CREATE INDEX "hosted_pending_group_setup_expiry_idx"
  ON "hosted_pending_group_setup"("expires_at");
