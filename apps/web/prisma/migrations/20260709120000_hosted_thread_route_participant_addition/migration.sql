CREATE SEQUENCE "hosted_thread_route_participant_roster_applied_ordinal_seq" AS BIGINT;

ALTER TABLE "hosted_thread_route"
ADD COLUMN "pending_participant_addition" BOOLEAN DEFAULT false,
ADD COLUMN "participant_roster_applied_ordinal" BIGINT;

ALTER TABLE "hosted_thread_route"
ALTER COLUMN "participant_roster_applied_ordinal"
SET DEFAULT nextval('hosted_thread_route_participant_roster_applied_ordinal_seq');

ALTER SEQUENCE "hosted_thread_route_participant_roster_applied_ordinal_seq"
OWNED BY "hosted_thread_route"."participant_roster_applied_ordinal";
