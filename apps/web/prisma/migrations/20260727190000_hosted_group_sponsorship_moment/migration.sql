CREATE TABLE "hosted_group_sponsorship_moment" (
  "purchase_id" TEXT NOT NULL,
  "beneficiary_member_id" TEXT NOT NULL,
  "creator_member_id" TEXT NOT NULL,
  "configuration_digest" TEXT NOT NULL,
  "public_alias_encrypted" TEXT,
  "sponsor_message_encrypted" TEXT,
  "running_bit_request_encrypted" TEXT,
  "activated_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_group_sponsorship_moment_pkey"
    PRIMARY KEY ("purchase_id"),
  CONSTRAINT "hosted_group_sponsorship_moment_purchase_id_fkey"
    FOREIGN KEY ("purchase_id")
    REFERENCES "hosted_usage_credit_purchase"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "hosted_group_sponsorship_moment_creator_id_fkey"
    FOREIGN KEY ("creator_member_id")
    REFERENCES "hosted_member"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX "hosted_group_sponsorship_moment_active_idx"
  ON "hosted_group_sponsorship_moment"(
    "beneficiary_member_id",
    "expires_at"
  );

CREATE INDEX "hosted_group_sponsorship_moment_creator_idx"
  ON "hosted_group_sponsorship_moment"(
    "creator_member_id",
    "created_at"
  );
