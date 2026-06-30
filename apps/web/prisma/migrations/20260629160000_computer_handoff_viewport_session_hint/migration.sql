ALTER TABLE "hosted_web_session"
  ADD COLUMN "computer_handoff_viewport_width" INTEGER,
  ADD COLUMN "computer_handoff_viewport_height" INTEGER,
  ADD COLUMN "computer_handoff_viewport_observed_at" TIMESTAMP(3);
