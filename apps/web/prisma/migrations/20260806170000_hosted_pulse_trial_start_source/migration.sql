-- Descriptive trial provenance is additive and non-authoritative. Existing
-- rows remain null because mutable identity state cannot prove how a
-- historical trial originally started.
ALTER TABLE "hosted_member_billing_ref"
  ADD COLUMN "pulse_trial_start_source" TEXT;
