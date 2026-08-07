ALTER TABLE "hosted_linq_delivery"
ADD COLUMN "member_id" TEXT,
ADD COLUMN "participant_phone_lookup_key" TEXT,
ADD COLUMN "participant_phone_encrypted" TEXT;

ALTER TABLE "hosted_linq_delivery"
ADD CONSTRAINT "hosted_linq_delivery_member_id_fkey"
FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "hosted_linq_delivery_member_attempted_idx"
ON "hosted_linq_delivery"("member_id", "attempted_at");
