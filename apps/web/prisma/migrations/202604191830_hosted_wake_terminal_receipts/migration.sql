CREATE TABLE "hosted_wake_terminal" (
    "wake_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "wake_seq" BIGINT NOT NULL,
    "state" TEXT NOT NULL,
    "fetched_committed_seq" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_wake_terminal_pkey" PRIMARY KEY ("wake_id")
);

CREATE UNIQUE INDEX "hosted_wake_terminal_user_id_wake_seq_key" ON "hosted_wake_terminal"("user_id", "wake_seq");
CREATE INDEX "hosted_wake_terminal_user_id_idx" ON "hosted_wake_terminal"("user_id");
CREATE INDEX "hosted_wake_terminal_user_id_wake_seq_idx" ON "hosted_wake_terminal"("user_id", "wake_seq");

ALTER TABLE "hosted_wake_terminal"
    ADD CONSTRAINT "hosted_wake_terminal_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hosted_wake_terminal"
    ADD CONSTRAINT "hosted_wake_terminal_wake_id_fkey"
    FOREIGN KEY ("wake_id") REFERENCES "hosted_wake"("id") ON DELETE CASCADE ON UPDATE CASCADE;
