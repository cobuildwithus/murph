DROP INDEX "hosted_wake_dedupe_key_key";

CREATE UNIQUE INDEX "hosted_wake_user_id_dedupe_key_key" ON "hosted_wake"("user_id", "dedupe_key");

ALTER TABLE "hosted_wake_event"
    DROP CONSTRAINT "hosted_wake_event_pkey";

ALTER TABLE "hosted_wake_event"
    ADD CONSTRAINT "hosted_wake_event_pkey" PRIMARY KEY ("user_id", "event_id");

CREATE INDEX "hosted_wake_event_event_id_idx" ON "hosted_wake_event"("event_id");

DROP INDEX "linq_webhook_event_event_id_key";

CREATE UNIQUE INDEX "linq_webhook_event_user_id_event_id_key" ON "linq_webhook_event"("user_id", "event_id");
CREATE INDEX "linq_webhook_event_event_id_idx" ON "linq_webhook_event"("event_id");
