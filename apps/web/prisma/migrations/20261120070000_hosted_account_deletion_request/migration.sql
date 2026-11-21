CREATE TABLE "hosted_account_deletion_request" (
  "member_id" TEXT PRIMARY KEY REFERENCES "hosted_member" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "next_attempt_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "hosted_account_deletion_request_next_attempt_at_member_id_idx"
  ON "hosted_account_deletion_request" ("next_attempt_at", "member_id");
