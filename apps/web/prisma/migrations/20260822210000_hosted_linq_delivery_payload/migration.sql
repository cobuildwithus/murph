ALTER TABLE "hosted_linq_delivery"
ADD COLUMN "payload_owner_member_id" TEXT,
ADD COLUMN "payload_ciphertext" TEXT,
ADD COLUMN "payload_schema" TEXT;

ALTER TABLE "hosted_linq_delivery"
ADD CONSTRAINT "hosted_linq_delivery_payload_owner_member_id_fkey"
FOREIGN KEY ("payload_owner_member_id")
REFERENCES "hosted_member"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

CREATE INDEX "hosted_linq_delivery_payload_owner_member_id_idx"
ON "hosted_linq_delivery"("payload_owner_member_id");
