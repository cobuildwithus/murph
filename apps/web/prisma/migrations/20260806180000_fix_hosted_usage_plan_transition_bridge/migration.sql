BEGIN;

-- Serialize the corrective cleanup with both old and new Web writers. The
-- trigger name and function signature stay unchanged so rolling deployments
-- continue to use the same compatibility bridge.
LOCK TABLE "hosted_member_billing_ref" IN ACCESS EXCLUSIVE MODE;

-- Keep only the three directed plan upgrades recognized by the bridge. The
-- original nullable boolean branch could stamp arbitrary or partial marker
-- shapes, so equality alone is not a complete repair.
UPDATE "hosted_member_billing_ref"
SET
  "usage_plan_transition_at" = NULL,
  "usage_plan_transition_from_code" = NULL,
  "usage_plan_transition_kind" = NULL,
  "usage_plan_transition_to_code" = NULL
WHERE "usage_plan_transition_kind" = 'plan_upgrade'
  AND (
    (
      "usage_plan_transition_from_code" = 'launch_group_monthly'
      AND "usage_plan_transition_to_code" IN ('launch_monthly', 'launch_edge_monthly')
    )
    OR (
      "usage_plan_transition_from_code" = 'launch_monthly'
      AND "usage_plan_transition_to_code" = 'launch_edge_monthly'
    )
  ) IS NOT TRUE;

CREATE OR REPLACE FUNCTION capture_hosted_member_usage_plan_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  is_plan_upgrade BOOLEAN;
  is_trial_conversion BOOLEAN;
  transition_was_written BOOLEAN;
BEGIN
  is_plan_upgrade := (
    OLD.current_billing_phase = 'paid'
    AND NEW.current_billing_phase = 'paid'
    AND (
      (OLD.current_billing_plan_code = 'launch_group_monthly'
        AND NEW.current_billing_plan_code IN ('launch_monthly', 'launch_edge_monthly'))
      OR (OLD.current_billing_plan_code = 'launch_monthly'
        AND NEW.current_billing_plan_code = 'launch_edge_monthly')
    )
  ) IS TRUE;
  is_trial_conversion := (
    OLD.current_billing_phase = 'trial'
    AND NEW.current_billing_phase = 'paid'
    AND OLD.current_billing_plan_code = 'launch_monthly'
    AND NEW.current_billing_plan_code = 'launch_monthly'
    AND NEW.current_checkout_offer = 'pulse_trial_7d'
  ) IS TRUE;

  IF NOT (is_plan_upgrade OR is_trial_conversion) THEN
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

COMMIT;
