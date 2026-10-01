BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE "hosted_member_approval_credentials" (
    "member_id" TEXT NOT NULL,
    "credentials_encrypted" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hosted_member_approval_credentials_pkey" PRIMARY KEY ("member_id"),
    CONSTRAINT "hosted_member_approval_credentials_member_id_fkey"
        FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

COMMIT;
