CREATE TYPE "HostedUsageReferralPolicyCode" AS ENUM (
  'new_person_activation_v1',
  'active_group_v1'
);

CREATE TYPE "HostedUsageReferralStatus" AS ENUM (
  'armed',
  'target_bound',
  'rewarded',
  'superseded',
  'canceled',
  'expired',
  'disqualified'
);

CREATE TABLE "hosted_usage_referral" (
  "id" TEXT NOT NULL,
  "referrer_member_id" TEXT,
  "beneficiary_member_id" TEXT NOT NULL,
  "introduced_member_id" TEXT,
  "policy_code" "HostedUsageReferralPolicyCode" NOT NULL,
  "policy_version" TEXT NOT NULL,
  "reward_usd_micros" BIGINT NOT NULL,
  "status" "HostedUsageReferralStatus" NOT NULL DEFAULT 'armed',
  "referrer_subject_key" TEXT,
  "target_container_member_id" TEXT,
  "human_message_count" INTEGER NOT NULL DEFAULT 0,
  "non_referrer_message_count" INTEGER NOT NULL DEFAULT 0,
  "observed_event_keys_json" JSONB,
  "observed_speaker_keys_json" JSONB,
  "first_human_message_at" TIMESTAMP(3),
  "last_human_message_at" TIMESTAMP(3),
  "armed_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "target_bound_at" TIMESTAMP(3),
  "qualified_at" TIMESTAMP(3),
  "rewarded_at" TIMESTAMP(3),
  "celebration_queued_at" TIMESTAMP(3),
  "terminal_at" TIMESTAMP(3),
  "terminal_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_usage_referral_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hosted_usage_referral_reward_positive"
    CHECK ("reward_usd_micros" > 0),
  CONSTRAINT "hosted_usage_referral_counts_valid"
    CHECK (
      "human_message_count" BETWEEN 0 AND 15
      AND "non_referrer_message_count" BETWEEN 0 AND 8
      AND "non_referrer_message_count" <= "human_message_count"
    ),
  CONSTRAINT "hosted_usage_referral_window_valid"
    CHECK ("expires_at" > "armed_at"),
  CONSTRAINT "hosted_usage_referral_armed_shape_valid"
    CHECK (
      "status" <> 'armed'
      OR (
        "referrer_member_id" IS NOT NULL
        AND "referrer_subject_key" IS NOT NULL
        AND "target_container_member_id" IS NULL
        AND "target_bound_at" IS NULL
      )
    ),
  CONSTRAINT "hosted_usage_referral_bound_shape_valid"
    CHECK (
      "status" <> 'target_bound'
      OR (
        "referrer_member_id" IS NOT NULL
        AND "referrer_subject_key" IS NOT NULL
        AND "target_container_member_id" IS NOT NULL
        AND "target_bound_at" IS NOT NULL
      )
    ),
  CONSTRAINT "hosted_usage_referral_reward_shape_valid"
    CHECK (
      (
        "status" = 'rewarded'
        AND "qualified_at" IS NOT NULL
        AND "qualified_at" < "expires_at"
        AND "rewarded_at" IS NOT NULL
      )
      OR (
        "status" <> 'rewarded'
        AND "rewarded_at" IS NULL
        AND "celebration_queued_at" IS NULL
      )
    ),
  CONSTRAINT "hosted_usage_referral_qualification_window_valid"
    CHECK (
      "qualified_at" IS NULL
      OR (
        "status" IN ('target_bound', 'rewarded')
        AND "qualified_at" >= "target_bound_at"
        AND "qualified_at" < "expires_at"
      )
    ),
  CONSTRAINT "hosted_usage_referral_celebration_shape_valid"
    CHECK (
      "celebration_queued_at" IS NULL
      OR (
        "status" = 'rewarded'
        AND "rewarded_at" IS NOT NULL
        AND "celebration_queued_at" >= "rewarded_at"
      )
    ),
  CONSTRAINT "hosted_usage_referral_referrer_member_id_fkey"
    FOREIGN KEY ("referrer_member_id") REFERENCES "hosted_member"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "hosted_usage_referral_beneficiary_member_id_fkey"
    FOREIGN KEY ("beneficiary_member_id") REFERENCES "hosted_member"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "hosted_usage_referral_introduced_member_id_fkey"
    FOREIGN KEY ("introduced_member_id") REFERENCES "hosted_member"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "hosted_usage_referral_target_container_member_id_fkey"
    FOREIGN KEY ("target_container_member_id") REFERENCES "hosted_thread_container"("member_id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "hosted_usage_referral_target_container_key"
  ON "hosted_usage_referral"("target_container_member_id");

CREATE UNIQUE INDEX "hosted_usage_referral_one_armed_per_referrer"
  ON "hosted_usage_referral"("referrer_member_id")
  WHERE "status" = 'armed';

CREATE UNIQUE INDEX "hosted_usage_referral_one_reward_per_introduced_member"
  ON "hosted_usage_referral"("introduced_member_id")
  WHERE "rewarded_at" IS NOT NULL
    AND "introduced_member_id" IS NOT NULL;

CREATE INDEX "hosted_usage_referral_referrer_status_armed_idx"
  ON "hosted_usage_referral"("referrer_member_id", "status", "armed_at");

CREATE INDEX "hosted_usage_referral_beneficiary_rewarded_idx"
  ON "hosted_usage_referral"("beneficiary_member_id", "rewarded_at");

CREATE INDEX "hosted_usage_referral_expiry_status_idx"
  ON "hosted_usage_referral"("expires_at", "status");

CREATE INDEX "hosted_usage_referral_recovery_idx"
  ON "hosted_usage_referral"("updated_at", "id")
  WHERE (
    "status" = 'target_bound'
    AND "qualified_at" IS NOT NULL
  ) OR (
    "status" = 'rewarded'
    AND "celebration_queued_at" IS NULL
  );

CREATE INDEX "hosted_usage_referral_introduced_member_idx"
  ON "hosted_usage_referral"("introduced_member_id");

ALTER TABLE "hosted_usage_credit_entry"
  ALTER COLUMN "purchase_id" DROP NOT NULL,
  ADD COLUMN "referral_id" TEXT;

ALTER TABLE "hosted_usage_credit_entry"
  ADD CONSTRAINT "hosted_usage_credit_entry_referral_id_fkey"
    FOREIGN KEY ("referral_id") REFERENCES "hosted_usage_referral"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "hosted_usage_credit_entry_referral_grant_key"
  ON "hosted_usage_credit_entry"("referral_id")
  WHERE "kind" = 'referral_grant';

CREATE INDEX "hosted_usage_credit_entry_referral_sequence_idx"
  ON "hosted_usage_credit_entry"("referral_id", "beneficiary_sequence");

CREATE TABLE "hosted_usage_credit_grant" (
  "entry_id" TEXT NOT NULL,
  "remaining_usd_micros" BIGINT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_usage_credit_grant_pkey" PRIMARY KEY ("entry_id"),
  CONSTRAINT "hosted_usage_credit_grant_remaining_nonnegative"
    CHECK ("remaining_usd_micros" >= 0),
  CONSTRAINT "hosted_usage_credit_grant_entry_id_fkey"
    FOREIGN KEY ("entry_id") REFERENCES "hosted_usage_credit_entry"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "hosted_usage_credit_grant" (
  "entry_id",
  "remaining_usd_micros",
  "created_at",
  "updated_at"
)
SELECT
  entry."id",
  purchase."remaining_credit_usd_micros",
  entry."created_at",
  CURRENT_TIMESTAMP
FROM "hosted_usage_credit_entry" AS entry
INNER JOIN "hosted_usage_credit_purchase" AS purchase
  ON purchase."id" = entry."purchase_id"
WHERE entry."kind" = 'purchase_grant';
