-- Contract only after the per-tier reader release and then the aggregate-writer
-- removal release are live. Every ordinary function and Stripe reconciliation
-- Workflow pinned to a pre-writer-removal deployment must have settled.
-- The ordinary postdeploy request wait does not prove durable Workflow drain.
-- The writer-removal release becomes the schema rollback floor after this DROP.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "hosted_account_group_billing_ref"
  DROP COLUMN IF EXISTS "billed_seat_count";
