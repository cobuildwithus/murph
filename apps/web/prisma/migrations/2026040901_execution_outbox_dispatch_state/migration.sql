ALTER TABLE "execution_outbox"
ADD COLUMN "dispatch_state" TEXT NOT NULL DEFAULT 'queued';
