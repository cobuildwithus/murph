CREATE TABLE "hosted_linq_processed_event" (
  "event_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "hosted_linq_processed_event_pkey" PRIMARY KEY ("event_id")
);

CREATE INDEX "hosted_linq_processed_event_created_at_idx"
  ON "hosted_linq_processed_event"("created_at");
