CREATE TABLE "hosted_group_disclosure_permission" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "permission_text_encrypted" TEXT NOT NULL,
    "permission_digest" TEXT NOT NULL,
    "message_lookup_key" TEXT NOT NULL,
    "posted_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_group_disclosure_permission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hosted_group_disclosure_grant" (
    "id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "hosted_group_disclosure_grant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hosted_group_disclosure_permission_message_lookup_key_key"
ON "hosted_group_disclosure_permission"("message_lookup_key");

CREATE INDEX "hosted_group_disclosure_permission_group_id_idx"
ON "hosted_group_disclosure_permission"("group_id");

CREATE INDEX "hosted_group_disclosure_grant_membership_id_revoked_at_granted_at_idx"
ON "hosted_group_disclosure_grant"("membership_id", "revoked_at", "granted_at");

CREATE INDEX "hosted_group_disclosure_grant_permission_id_idx"
ON "hosted_group_disclosure_grant"("permission_id");

CREATE UNIQUE INDEX "hosted_group_disclosure_grant_permission_id_membership_id_active_key"
ON "hosted_group_disclosure_grant"("permission_id", "membership_id")
WHERE "revoked_at" IS NULL;

ALTER TABLE "hosted_group_disclosure_permission"
ADD CONSTRAINT "hosted_group_disclosure_permission_group_id_fkey"
FOREIGN KEY ("group_id") REFERENCES "hosted_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hosted_group_disclosure_grant"
ADD CONSTRAINT "hosted_group_disclosure_grant_permission_id_fkey"
FOREIGN KEY ("permission_id") REFERENCES "hosted_group_disclosure_permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hosted_group_disclosure_grant"
ADD CONSTRAINT "hosted_group_disclosure_grant_membership_id_fkey"
FOREIGN KEY ("membership_id") REFERENCES "hosted_group_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
