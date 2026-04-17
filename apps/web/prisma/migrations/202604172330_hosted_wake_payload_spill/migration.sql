CREATE TABLE "hosted_wake_payload" (
    "wake_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "payload_ciphertext" TEXT NOT NULL,
    "payload_schema" TEXT NOT NULL,
    "payload_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_wake_payload_pkey" PRIMARY KEY ("wake_id")
);

CREATE INDEX "hosted_wake_payload_user_id_idx" ON "hosted_wake_payload"("user_id");

ALTER TABLE "hosted_wake_payload"
    ADD CONSTRAINT "hosted_wake_payload_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hosted_wake_payload"
    ADD CONSTRAINT "hosted_wake_payload_wake_id_fkey"
    FOREIGN KEY ("wake_id") REFERENCES "hosted_wake"("id") ON DELETE CASCADE ON UPDATE CASCADE;
