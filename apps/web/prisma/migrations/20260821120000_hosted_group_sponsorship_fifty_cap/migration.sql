ALTER TABLE "hosted_group_sponsorship_authorization"
  DROP CONSTRAINT "hosted_group_sponsorship_authorization_cap_valid",
  ADD CONSTRAINT "hosted_group_sponsorship_authorization_cap_valid"
    CHECK (
      "monthly_cap_minor" IN (500, 1000, 2000, 5000)
      AND (
        "pending_monthly_cap_minor" IS NULL
        OR "pending_monthly_cap_minor" IN (500, 1000, 2000, 5000)
      )
    ) NOT VALID;

ALTER TABLE "hosted_group_sponsorship_authorization"
  VALIDATE CONSTRAINT "hosted_group_sponsorship_authorization_cap_valid";
