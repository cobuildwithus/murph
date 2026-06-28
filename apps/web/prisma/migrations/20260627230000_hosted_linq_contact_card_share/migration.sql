CREATE TABLE "hosted_linq_contact_card_share" (
  "linq_chat_lookup_key" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "last_contact_card_share_attempted_at" TIMESTAMP(3),
  "last_contact_card_share_succeeded_at" TIMESTAMP(3),
  "contact_card_share_claimed_at" TIMESTAMP(3),
  "contact_card_share_claim_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_linq_contact_card_share_pkey"
    PRIMARY KEY ("linq_chat_lookup_key"),
  CONSTRAINT "hosted_linq_contact_card_share_member_id_fkey"
    FOREIGN KEY ("member_id")
    REFERENCES "hosted_member"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "hosted_linq_contact_card_share_contact_card_share_claim_id_key"
  ON "hosted_linq_contact_card_share"("contact_card_share_claim_id");

CREATE INDEX "hosted_linq_contact_card_share_member_id_idx"
  ON "hosted_linq_contact_card_share"("member_id");

CREATE INDEX "hosted_linq_contact_card_share_last_contact_card_share_attempted_at_idx"
  ON "hosted_linq_contact_card_share"("last_contact_card_share_attempted_at");

CREATE INDEX "hosted_linq_contact_card_share_last_contact_card_share_succeeded_at_idx"
  ON "hosted_linq_contact_card_share"("last_contact_card_share_succeeded_at");

CREATE INDEX "hosted_linq_contact_card_share_contact_card_share_claimed_at_idx"
  ON "hosted_linq_contact_card_share"("contact_card_share_claimed_at");
