# Preserve unlabeled Postgres connection counts

Status: completed

## Outcome and owner

Keep observed Postgres connection counts usable when a state label is empty or
omitted. The existing Cloudflare metric parser owns normalization; missing
families, branch/role isolation, alert admission, and retries retain their owners.

## Evidence and approach

The state aggregator currently rejects every connection-state series if any
state label is falsy. Reproduce this with synthetic mixed-state scrapes before
changing production code. Prometheus permits empty labels and treats omission
as equivalent. Retain those observed counts under the empty state key instead
of dropping the whole family. Keep PgBouncer pool-label validation strict.

This is a parser change with no dependency, new state owner, migration, retry,
or provider call. A Cloudflare release activates it; old retained samples stay
historical. Production warnings alone cannot distinguish absent series from
unusable labels, so the live trigger remains unconfirmed without scrape evidence.

## Proof

- Failing-then-passing parser and scheduled-monitor regressions for unlabeled
  counts, normal states, and concrete saturation/aborted-state alerts.
- Missing family and missing branch/role/pool labels remain incomplete.
- Focused database-health suite, Cloudflare typecheck, complexity guard, and diff
  review. Internal operator monitoring only; no member changelog.

## Results

- Before the fix, both parser cases failed with the connection-state family
  marked missing. The three-check monitor reproduction recorded a failed first
  sample, a telemetry page on the second, and a deferred alert on the third.
- After the fix, all four database-health test files passed (134 tests). The
  monitor's final persistence assertion also passed: all three samples retain
  the synthetic total with no retry or page.
- `pnpm --filter @murphai/cloudflare-runner typecheck` passed after the change.
- `pnpm complexity:diff` passed with unchanged file debt and maximum complexity.
  Existing parser/evaluator hotspots are outside the changed aggregation logic;
  splitting them would broaden this correction without improving its contract.
- Parent diff review confirmed no dependency, schema, state-owner, retry,
  delivery, credential, or unrelated changes. Deployment and live scrape
  confirmation remain separate from the local reproduction and fix.
Updated: 2026-09-06
Completed: 2026-09-06
