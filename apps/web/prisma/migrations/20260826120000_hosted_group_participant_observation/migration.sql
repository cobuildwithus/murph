CREATE TABLE "hosted_group_participant_observation" (
  "contact_lookup_key" TEXT NOT NULL,
  "first_observed_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_group_participant_observation_pkey"
    PRIMARY KEY ("contact_lookup_key")
);

CREATE INDEX "hosted_group_participant_observation_expiry_idx"
ON "hosted_group_participant_observation"("expires_at", "contact_lookup_key");
