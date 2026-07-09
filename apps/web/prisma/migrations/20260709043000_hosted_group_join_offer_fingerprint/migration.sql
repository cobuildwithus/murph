ALTER TABLE "hosted_group_join_offer"
  ADD COLUMN "offer_fingerprint" TEXT;

UPDATE "hosted_group_join_offer"
SET "offer_fingerprint" = md5('legacy-hosted-group-join-offer:' || "id")
WHERE "offer_fingerprint" IS NULL;

ALTER TABLE "hosted_group_join_offer"
  ALTER COLUMN "message_lookup_key" DROP NOT NULL;

CREATE UNIQUE INDEX "hosted_group_join_offer_offer_fingerprint_key"
  ON "hosted_group_join_offer"("offer_fingerprint");
