# Hosted Web Contract Migrations

Use this directory for destructive hosted web database cleanup that must run
after the new Vercel production deployment is live and the prior production
function window has drained.

The immutable `20261031190000_recover_missing_game_recap` was a one-off
recovery through the normal lifecycle receipt and minute sweep. The direct game
storage migration `20261102230000_game_seat_storage` removes a column its SQL
needs, so the runner now omits it. Existing receipts and checksum history remain;
new recovery requests use the existing Ops recap-regeneration command. Do not
restore this retired migration to the executable list. Its historical SQL proof
runs in an isolated legacy schema. See `apps/web/README.md` § Direct game storage
cutover for the expressly approved predeploy exception and rollback floor.

Each migration lives in a timestamped subdirectory with a `migration.sql` file:

```text
apps/web/prisma/contract-migrations/20260707173000_drop_old_columns/migration.sql
```

Keep normal Prisma migrations backward compatible with the currently deployed
app. Additive changes such as new nullable columns, new tables, and new indexes
belong in `apps/web/prisma/migrations` so the Vercel predeploy wrapper can run
them before build. New required application shape does not start here: required
columns, renames, `ALTER COLUMN ... SET NOT NULL`, and incompatible type changes
need an expand/backfill/switch/final-cleanup sequence so both old and new app
deployments can survive the deploy window. Only final cleanup, such as dropping
old columns, tables, indexes, or constraints that deployed code no longer uses,
and post-convergence validating constraints belong here. A new validating
constraint must have a documented expand/backfill/switch proof and a production
preflight showing every existing row satisfies it. GitHub runs these migrations
only after Vercel reports the production deployment as successful, a bounded
drain wait has elapsed, and the production alias still points at that
deployment.

The historical
`20260720233000_hosted_group_usage_funding_invariants` directory remains
immutable, but the runner omits it because
`20260727040000_relax_hosted_usage_credit_detached_direct_proof` is the sole
owner of those two constraints. That backward-compatible Prisma predeploy
migration installs the constraints on a fresh database or replaces the earlier
strict definition before sessionless direct payments can be served. Do not
restore the superseded contract migration to the postdeploy list; doing so
would reintroduce the Checkout-Session requirement after promotion.

Contract migration SQL must be safe to run inside one transaction and should be
idempotent where PostgreSQL supports it, for example `DROP COLUMN IF EXISTS`.
The runner sets short transaction-local lock and statement timeouts before each
migration body; if cleanup cannot run without waiting on live traffic, let it
fail and retry later. Do not use commands that PostgreSQL forbids inside a
transaction, such as `CREATE INDEX CONCURRENTLY`.
If another contract migration run already owns the database advisory lock, the
runner fails closed instead of waiting past its current-production alias proof;
rerun the workflow after the active run finishes if cleanup still needs to
apply.

After cleanup applies, the rollback floor is the first deployed Vercel commit
that no longer reads or writes the dropped schema shape. Rolling back below that
floor requires restoring or re-expanding the database shape first, or deploying
a forward fix. Cloudflare `container_rollout=immediate` is not applicable to
this Vercel-only lane; the bounded drain wait and final alias check own the
old-function window.

The `20261101230000_drop_game_live_roster_key` cleanup follows the derived-pair
Web deployment. Its predeploy Prisma migration drops the obsolete roster CHECK
and unique index while preserving the nullable column for old functions. New
Web derives pairs from GamePlayer and serializes ten-slot admission under the
pair advisory lock. Converge Web before enabling the multi-game native flow;
then this runner drops the unused column after its ordinary drain. This Web
version is the rollback floor after cleanup; use a compatible forward fix.

The `20261104160000_drop_retired_band_commands` cleanup removes the three retired
band-command tables after the Web deployment deleting their consumers is live
and drained. Old runners receive an ordinary failed tool callback from the
removed route; they never access these tables directly. Deploy the new runner
after Web to remove its obsolete tool offer. This Web version is the rollback
floor after cleanup; restoring older Web requires re-expanding the tables first.
Companion app presence, Apple push routes and game notifications remain live.

The `20261106050000_drop_group_sponsorship_moment` cleanup removes the group
sponsorship moment table and the personalization stored in it, after the Web
deployment that stopped reading and writing it (#4615) is live and drained. That
deletion cannot be undone. Billing, recovery and revenue reporting never needed the
table, and the runner never accesses it directly. #4615 is the rollback floor after
cleanup; older Web writes this table, so restoring it requires re-expanding the
table first.

The retired invite code-send attempt/cooldown columns are deliberately absent from
this lane. Older deployment-pinned Stripe Workflows still select them during paid
activation. Retain the physical nullable columns until every older execution capable
of that read has settled; the ordinary function drain and production-alias check do
not establish this. See `docs/hosted-auth-migration.md` for the contraction gate.

The `20261111210000_drop_recap_media_scope` cleanup drops the obsolete nullable
runtime-owner recap admission field after the simplified Web consumer is live
and drained. Deploy Web before the matching runner, with no recap turns in
flight. This Web version is the rollback floor after cleanup; older Web requires
re-expanding the nullable JSON column first. The runtime-local media count is
in-memory only and needs no data migration.
