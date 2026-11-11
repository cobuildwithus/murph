-- Deploy Web without the retired invite send-code consumers, then drain old functions.
-- The current first-party OTP owner stores its own verification/rate-limit records.
ALTER TABLE "hosted_member_identity"
  DROP COLUMN IF EXISTS "signup_phone_code_sent_at",
  DROP COLUMN IF EXISTS "signup_phone_code_send_attempt_id",
  DROP COLUMN IF EXISTS "signup_phone_code_send_attempt_started_at";
