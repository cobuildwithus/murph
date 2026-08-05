BEGIN;

-- Acquire every rolling-writer boundary before changing or backfilling any of
-- them, so an old insert or billing transition cannot land between setup
-- statements and escape the compatibility bridges.
LOCK TABLE
  "hosted_ai_usage_period",
  "hosted_member_billing_ref",
  "hosted_account_group_membership"
IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "hosted_ai_usage_period"
  ADD COLUMN "highest_billing_plan_code" TEXT,
  ADD COLUMN "plan_reset_at" TIMESTAMP(3);

UPDATE "hosted_ai_usage_period"
SET "highest_billing_plan_code" = "billing_plan_code"
WHERE "highest_billing_plan_code" IS NULL;

-- Draining Web instances insert the old allowance-period column set. Seed
-- their plan high-water from the plan they observed so a later exact upgrade
-- can still be recognized. Remove this bridge only after every pre-migration
-- Web deployment has drained and no rollback can restore one.
CREATE FUNCTION initialize_hosted_usage_period_highest_plan()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.highest_billing_plan_code IS NULL THEN
    NEW.highest_billing_plan_code := NEW.billing_plan_code;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "hosted_usage_period_highest_plan_bridge"
BEFORE INSERT ON "hosted_ai_usage_period"
FOR EACH ROW
EXECUTE FUNCTION initialize_hosted_usage_period_highest_plan();

ALTER TABLE "hosted_member_billing_ref"
  ADD COLUMN "usage_plan_transition_at" TIMESTAMP(3),
  ADD COLUMN "usage_plan_transition_from_code" TEXT,
  ADD COLUMN "usage_plan_transition_kind" TEXT,
  ADD COLUMN "usage_plan_transition_to_code" TEXT;

ALTER TABLE "hosted_account_group_membership"
  ADD COLUMN "usage_plan_transition_at" TIMESTAMP(3),
  ADD COLUMN "usage_plan_transition_from_code" TEXT,
  ADD COLUMN "usage_plan_transition_kind" TEXT,
  ADD COLUMN "usage_plan_transition_to_code" TEXT;

-- Keep draining Web instances compatible with the new reconciliation owner.
-- Their billing writes already carry Stripe's event time but do not know the
-- additive transition columns. Snapshot that time only when the authoritative
-- billing state itself crosses a reset-eligible boundary.
CREATE FUNCTION capture_hosted_member_usage_plan_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  is_plan_upgrade BOOLEAN;
  is_trial_conversion BOOLEAN;
  transition_was_written BOOLEAN;
BEGIN
  is_plan_upgrade :=
    OLD.current_billing_phase = 'paid'
    AND NEW.current_billing_phase = 'paid'
    AND (
      (OLD.current_billing_plan_code = 'launch_group_monthly'
        AND NEW.current_billing_plan_code IN ('launch_monthly', 'launch_edge_monthly'))
      OR (OLD.current_billing_plan_code = 'launch_monthly'
        AND NEW.current_billing_plan_code = 'launch_edge_monthly')
    );
  is_trial_conversion :=
    OLD.current_billing_phase = 'trial'
    AND NEW.current_billing_phase = 'paid'
    AND OLD.current_billing_plan_code = 'launch_monthly'
    AND NEW.current_billing_plan_code = 'launch_monthly'
    AND NEW.current_checkout_offer = 'pulse_trial_7d';

  IF NOT is_plan_upgrade AND NOT is_trial_conversion THEN
    RETURN NEW;
  END IF;

  transition_was_written :=
    NEW.usage_plan_transition_at IS DISTINCT FROM OLD.usage_plan_transition_at
    OR NEW.usage_plan_transition_from_code IS DISTINCT FROM OLD.usage_plan_transition_from_code
    OR NEW.usage_plan_transition_kind IS DISTINCT FROM OLD.usage_plan_transition_kind
    OR NEW.usage_plan_transition_to_code IS DISTINCT FROM OLD.usage_plan_transition_to_code;
  IF transition_was_written OR NEW.last_stripe_event_created_at IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.usage_plan_transition_at := NEW.last_stripe_event_created_at;
  NEW.usage_plan_transition_from_code := OLD.current_billing_plan_code;
  NEW.usage_plan_transition_kind :=
    CASE WHEN is_trial_conversion THEN 'trial_conversion' ELSE 'plan_upgrade' END;
  NEW.usage_plan_transition_to_code := NEW.current_billing_plan_code;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "hosted_member_usage_plan_transition_bridge"
BEFORE UPDATE OF
  "current_billing_phase",
  "current_billing_plan_code",
  "current_checkout_offer",
  "last_stripe_event_created_at"
ON "hosted_member_billing_ref"
FOR EACH ROW
EXECUTE FUNCTION capture_hosted_member_usage_plan_transition();

-- Family membership is the access transition owner. Its update timestamp is
-- the local effective cutover for an older Web instance that cannot supply the
-- Stripe event timestamp explicitly.
CREATE FUNCTION capture_hosted_family_usage_plan_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  transition_was_written BOOLEAN;
BEGIN
  IF NOT (
    OLD.status = 'active'
    AND NEW.status = 'active'
    AND OLD.plan_code = 'pulse'
    AND NEW.plan_code = 'edge'
  ) THEN
    RETURN NEW;
  END IF;

  transition_was_written :=
    NEW.usage_plan_transition_at IS DISTINCT FROM OLD.usage_plan_transition_at
    OR NEW.usage_plan_transition_from_code IS DISTINCT FROM OLD.usage_plan_transition_from_code
    OR NEW.usage_plan_transition_kind IS DISTINCT FROM OLD.usage_plan_transition_kind
    OR NEW.usage_plan_transition_to_code IS DISTINCT FROM OLD.usage_plan_transition_to_code;
  IF transition_was_written THEN
    RETURN NEW;
  END IF;

  NEW.usage_plan_transition_at := NEW.updated_at;
  NEW.usage_plan_transition_from_code := 'launch_monthly';
  NEW.usage_plan_transition_kind := 'plan_upgrade';
  NEW.usage_plan_transition_to_code := 'launch_edge_monthly';
  RETURN NEW;
END;
$$;

CREATE TRIGGER "hosted_family_usage_plan_transition_bridge"
BEFORE UPDATE OF "plan_code", "status"
ON "hosted_account_group_membership"
FOR EACH ROW
EXECUTE FUNCTION capture_hosted_family_usage_plan_transition();

COMMIT;
