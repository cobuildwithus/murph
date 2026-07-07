CREATE TYPE "HostedCallCircleParticipantStatus" AS ENUM ('enrolled', 'paused');

CREATE TYPE "HostedCallCircleMatchStatus" AS ENUM ('proposed', 'asking', 'both_confirmed', 'bridging', 'completed', 'dropped', 'expired', 'canceled');

CREATE TYPE "HostedCallCircleMatchResponse" AS ENUM ('pending', 'confirmed', 'declined', 'countered');

CREATE TABLE "hosted_call_circle_participant" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "status" "HostedCallCircleParticipantStatus" NOT NULL DEFAULT 'enrolled',
    "preferences_json" JSONB,
    "last_matched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hosted_call_circle_participant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hosted_call_circle_match" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "member_a_id" TEXT NOT NULL,
    "member_b_id" TEXT NOT NULL,
    "window_start_at" TIMESTAMP(3) NOT NULL,
    "window_end_at" TIMESTAMP(3) NOT NULL,
    "status" "HostedCallCircleMatchStatus" NOT NULL DEFAULT 'proposed',
    "side_a_response" "HostedCallCircleMatchResponse" NOT NULL DEFAULT 'pending',
    "side_b_response" "HostedCallCircleMatchResponse" NOT NULL DEFAULT 'pending',
    "counter_used_a" BOOLEAN NOT NULL DEFAULT false,
    "counter_used_b" BOOLEAN NOT NULL DEFAULT false,
    "am_asked_at" TIMESTAMP(3),
    "final_asked_at" TIMESTAMP(3),
    "claimed_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "outcome" TEXT,
    "phone_call_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hosted_call_circle_match_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hosted_call_circle_participant_group_id_member_id_key" ON "hosted_call_circle_participant"("group_id", "member_id");
CREATE INDEX "hosted_call_circle_participant_member_id_idx" ON "hosted_call_circle_participant"("member_id");
CREATE UNIQUE INDEX "hosted_call_circle_match_group_id_member_a_id_member_b_id_window_start_at_key" ON "hosted_call_circle_match"("group_id", "member_a_id", "member_b_id", "window_start_at");
CREATE INDEX "hosted_call_circle_match_group_id_created_at_idx" ON "hosted_call_circle_match"("group_id", "created_at");
CREATE INDEX "hosted_call_circle_match_status_window_start_at_idx" ON "hosted_call_circle_match"("status", "window_start_at");
CREATE INDEX "hosted_call_circle_match_member_a_id_idx" ON "hosted_call_circle_match"("member_a_id");
CREATE INDEX "hosted_call_circle_match_member_b_id_idx" ON "hosted_call_circle_match"("member_b_id");
CREATE INDEX "hosted_call_circle_match_phone_call_id_idx" ON "hosted_call_circle_match"("phone_call_id");

ALTER TABLE "hosted_call_circle_participant" ADD CONSTRAINT "hosted_call_circle_participant_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "hosted_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hosted_call_circle_participant" ADD CONSTRAINT "hosted_call_circle_participant_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hosted_call_circle_match" ADD CONSTRAINT "hosted_call_circle_match_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "hosted_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hosted_call_circle_match" ADD CONSTRAINT "hosted_call_circle_match_member_a_id_fkey" FOREIGN KEY ("member_a_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hosted_call_circle_match" ADD CONSTRAINT "hosted_call_circle_match_member_b_id_fkey" FOREIGN KEY ("member_b_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hosted_call_circle_match" ADD CONSTRAINT "hosted_call_circle_match_phone_call_id_fkey" FOREIGN KEY ("phone_call_id") REFERENCES "hosted_phone_call"("id") ON DELETE SET NULL ON UPDATE CASCADE;
