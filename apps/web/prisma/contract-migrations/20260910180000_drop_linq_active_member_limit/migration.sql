-- Merge only after the cap-free Web/CLI release is deployed and admitted for rollback.
-- Prior Web requests, applicable pinned Workflows, and old CLI invocations must
-- have drained; old CLI checkouts must no longer be runnable by operators/jobs.
-- See docs/hosted-linq-db-home-lines-migration.md for the pre-merge gates.
ALTER TABLE "hosted_linq_line" DROP COLUMN IF EXISTS "active_member_limit";
