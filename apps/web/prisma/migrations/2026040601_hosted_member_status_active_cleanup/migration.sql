UPDATE "hosted_member"
SET "status" = 'registered'
WHERE "status" = 'active';

ALTER TABLE "hosted_member"
ALTER COLUMN "status" DROP DEFAULT;

CREATE TYPE "HostedMemberStatus_next" AS ENUM ('invited', 'registered', 'suspended');

ALTER TABLE "hosted_member"
ALTER COLUMN "status" TYPE "HostedMemberStatus_next"
USING ("status"::text::"HostedMemberStatus_next");

DROP TYPE "HostedMemberStatus";
ALTER TYPE "HostedMemberStatus_next" RENAME TO "HostedMemberStatus";

ALTER TABLE "hosted_member"
ALTER COLUMN "status" SET DEFAULT 'invited';
