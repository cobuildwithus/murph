-- AlterTable
ALTER TABLE "hosted_member_identity"
  ALTER COLUMN "masked_phone_number_hint" DROP NOT NULL,
  ALTER COLUMN "phone_lookup_key" DROP NOT NULL;
