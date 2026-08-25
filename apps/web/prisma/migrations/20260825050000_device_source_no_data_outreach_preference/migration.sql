CREATE TABLE "device_source_no_data_outreach_preference" (
  "user_id" TEXT NOT NULL,
  "source_provider_slug" TEXT NOT NULL,
  "reminder_after_days" INTEGER,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "device_source_no_data_outreach_preference_pkey"
    PRIMARY KEY ("user_id", "source_provider_slug"),
  CONSTRAINT "device_source_no_data_outreach_preference_days_check"
    CHECK (
      "reminder_after_days" IS NULL
      OR "reminder_after_days" BETWEEN 5 AND 30
    )
);
