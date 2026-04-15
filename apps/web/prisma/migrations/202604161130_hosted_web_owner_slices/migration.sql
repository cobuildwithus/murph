-- CreateTable
CREATE TABLE "hosted_member_email_authorization" (
    "member_id" TEXT NOT NULL,
    "verified_email_lookup_key" TEXT,
    "verified_email_address_encrypted" TEXT,
    "verified_email_verified_at" TIMESTAMP(3),
    "direct_public_sender_lookup_key" TEXT,
    "direct_public_sender_address_encrypted" TEXT,
    "direct_public_sender_authorized_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "hosted_share_payload" (
    "share_id" TEXT NOT NULL,
    "payload_schema" TEXT NOT NULL DEFAULT 'murph.hosted-share-payload.v1',
    "payload_encrypted" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "hosted_member_email_authorization_member_id_key" ON "hosted_member_email_authorization"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_member_email_authorization_verified_email_lookup_key_key" ON "hosted_member_email_authorization"("verified_email_lookup_key");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_member_email_authorization_direct_public_sender_lookup_key_key" ON "hosted_member_email_authorization"("direct_public_sender_lookup_key");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_share_payload_share_id_key" ON "hosted_share_payload"("share_id");

-- AddForeignKey
ALTER TABLE "hosted_member_email_authorization" ADD CONSTRAINT "hosted_member_email_authorization_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_share_payload" ADD CONSTRAINT "hosted_share_payload_share_id_fkey" FOREIGN KEY ("share_id") REFERENCES "hosted_share_link"("id") ON DELETE CASCADE ON UPDATE CASCADE;
