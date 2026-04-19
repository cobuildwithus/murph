CREATE TABLE "hosted_wake_event" (
    "event_id" TEXT NOT NULL,
    "wake_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "replaced_by_event_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_wake_event_pkey" PRIMARY KEY ("event_id")
);

CREATE INDEX "hosted_wake_event_user_id_idx" ON "hosted_wake_event"("user_id");
CREATE INDEX "hosted_wake_event_user_id_replaced_by_event_id_idx" ON "hosted_wake_event"("user_id", "replaced_by_event_id");
CREATE INDEX "hosted_wake_event_wake_id_idx" ON "hosted_wake_event"("wake_id");

INSERT INTO "hosted_wake_event" (
    "event_id",
    "wake_id",
    "user_id",
    "created_at",
    "updated_at"
)
-- Greenfield hard cut: backfill only the currently visible wake identity.
-- Event ids already overwritten by prior in-place coalescing are not reconstructible from durable data.
SELECT
    "dedupe_key",
    "id",
    "user_id",
    "created_at",
    "updated_at"
FROM "hosted_wake"
WHERE "dedupe_key" IS NOT NULL;

ALTER TABLE "hosted_wake_event"
    ADD CONSTRAINT "hosted_wake_event_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hosted_wake_event"
    ADD CONSTRAINT "hosted_wake_event_wake_id_fkey"
    FOREIGN KEY ("wake_id") REFERENCES "hosted_wake"("id") ON DELETE CASCADE ON UPDATE CASCADE;
