ALTER TABLE "execution_outbox"
  ALTER COLUMN "next_attempt_at" DROP NOT NULL;

UPDATE "execution_outbox"
SET "next_attempt_at" = NULL
WHERE "status" IN ('completed', 'failed');
