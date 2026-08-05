ALTER TABLE "hosted_invite"
ADD COLUMN "referrer_member_id" TEXT;

CREATE INDEX "hosted_invite_referrer_member_id_created_at_idx"
ON "hosted_invite"("referrer_member_id", "created_at");

ALTER TABLE "hosted_invite"
ADD CONSTRAINT "hosted_invite_referrer_member_id_fkey"
FOREIGN KEY ("referrer_member_id")
REFERENCES "hosted_member"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
