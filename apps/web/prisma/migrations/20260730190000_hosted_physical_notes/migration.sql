CREATE TYPE "HostedPhysicalNoteStatus" AS ENUM (
  'starting',
  'accepted',
  'failed'
);

CREATE TABLE "hosted_physical_note" (
  "id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "request_key" TEXT NOT NULL,
  "request_fingerprint" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'lob',
  "provider_letter_id" TEXT,
  "status" "HostedPhysicalNoteStatus" NOT NULL DEFAULT 'starting',
  "complimentary_offer_code" TEXT,
  "provider_cost_usd_micros" BIGINT NOT NULL,
  "pricing_version" TEXT NOT NULL,
  "accepted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hosted_physical_note_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hosted_physical_note_provider_letter_id_key"
  ON "hosted_physical_note"("provider_letter_id");
CREATE UNIQUE INDEX "hosted_physical_note_member_id_request_key_key"
  ON "hosted_physical_note"("member_id", "request_key");
CREATE UNIQUE INDEX "hosted_physical_note_member_id_complimentary_offer_code_key"
  ON "hosted_physical_note"("member_id", "complimentary_offer_code");

ALTER TABLE "hosted_physical_note"
  ADD CONSTRAINT "hosted_physical_note_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
