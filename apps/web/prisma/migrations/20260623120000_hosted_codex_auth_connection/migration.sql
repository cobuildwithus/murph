CREATE TABLE "hosted_codex_auth_connection" (
    "member_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "attempt_id" TEXT NOT NULL,
    "verification_url" TEXT,
    "user_code" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_codex_auth_connection_pkey" PRIMARY KEY ("member_id")
);

ALTER TABLE "hosted_codex_auth_connection"
    ADD CONSTRAINT "hosted_codex_auth_connection_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
