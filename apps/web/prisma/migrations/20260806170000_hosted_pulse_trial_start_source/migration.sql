-- Descriptive trial provenance is additive and non-authoritative. Existing
-- rows remain null because mutable identity state cannot prove how a
-- historical trial originally started.
ALTER TABLE "hosted_member_billing_ref"
  ADD COLUMN "pulse_trial_start_source" TEXT;

ALTER TABLE "hosted_member_billing_ref"
  ADD CONSTRAINT "hosted_member_billing_ref_pulse_trial_start_source_check"
  CHECK (
    "pulse_trial_start_source" IS NULL
    OR "pulse_trial_start_source" IN (
      'web_onboarding',
      'companion_onboarding',
      'linq_instant_start'
    )
  );
