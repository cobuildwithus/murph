CREATE UNIQUE INDEX "hosted_usage_referral_one_armed_policy_per_destination"
  ON "hosted_usage_referral"(
    "referrer_member_id",
    "beneficiary_member_id",
    "policy_code"
  )
  WHERE "status" = 'armed';

CREATE UNIQUE INDEX "hosted_usage_referral_target_policy_key"
  ON "hosted_usage_referral"("target_container_member_id", "policy_code");

DROP INDEX "hosted_usage_referral_target_container_key";
DROP INDEX "hosted_usage_referral_one_armed_per_referrer";
