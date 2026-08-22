ALTER TABLE "hosted_linq_delivery"
ADD COLUMN "payload_owner_member_id" TEXT,
ADD COLUMN "payload_ciphertext" TEXT,
ADD COLUMN "payload_schema" TEXT;

ALTER TABLE "hosted_linq_delivery"
ADD CONSTRAINT "hosted_linq_delivery_payload_complete_check"
CHECK (
  (
    "payload_owner_member_id" IS NULL
    AND "payload_ciphertext" IS NULL
    AND "payload_schema" IS NULL
  )
  OR
  (
    "payload_owner_member_id" IS NOT NULL
    AND "payload_ciphertext" IS NOT NULL
    AND "payload_schema" IS NOT NULL
  )
);

ALTER TABLE "hosted_linq_delivery"
ADD CONSTRAINT "hosted_linq_delivery_payload_owner_member_id_fkey"
FOREIGN KEY ("payload_owner_member_id")
REFERENCES "hosted_member"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

CREATE INDEX "hosted_linq_delivery_payload_owner_member_id_idx"
ON "hosted_linq_delivery"("payload_owner_member_id");
