DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "hosted_member_billing_ref"
    WHERE "pulse_trial_start_source" IS NOT NULL
      AND "pulse_trial_start_source" NOT IN (
        'web_onboarding',
        'companion_onboarding',
        'linq_instant_start'
      )
  ) THEN
    RAISE EXCEPTION
      'Cannot validate Pulse trial start sources while an unsupported value remains.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'hosted_member_billing_ref_pulse_trial_start_source_check'
      AND conrelid = 'hosted_member_billing_ref'::regclass
  ) THEN
    ALTER TABLE "hosted_member_billing_ref"
      ADD CONSTRAINT "hosted_member_billing_ref_pulse_trial_start_source_check"
      CHECK (
        "pulse_trial_start_source" IS NULL
        OR "pulse_trial_start_source" IN (
          'web_onboarding',
          'companion_onboarding',
          'linq_instant_start'
        )
      ) NOT VALID;
  END IF;
END
$$;

ALTER TABLE "hosted_member_billing_ref"
  VALIDATE CONSTRAINT "hosted_member_billing_ref_pulse_trial_start_source_check";
