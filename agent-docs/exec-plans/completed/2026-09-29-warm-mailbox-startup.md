# Reduce mailbox cold startup cost

Status: completed
Created: 2026-09-29
Updated: 2026-09-30

## Outcome and architecture

Reduce message admission startup work while preserving signature verification,
one-use nonces, fresh access checks, runtime fencing, and existing typing timing.
Private production evidence localizes the current delay to a fresh Web mailbox
handler and its first database operation; the runner control call was prompt.
Platform time before handler entry remains partly unattributed.

Use the existing Prisma client generator's supported `small` compiler. The final
runtime diff is one build setting. No service, cache, warmup traffic, state,
protocol, dependency version, request ordering, or alert classification changes.
No database migration or coordinated Worker rollout is needed.

## Product UX

Outcome: Reduce cold database initialization before admitted messages execute.
Reaches: Warm and cold workspaces whose Web callback reaches a fresh instance.
Proof: Synthetic local database benchmarks, existing mailbox/auth tests and
actual PostgreSQL concurrency tests. Production tail latency remains unverified;
local results do not establish a fixed end-to-end response deadline.

## Verification

Twenty alternating fresh-process runs per compiler against a local database and
a synthetic missing-member nested projection measured median cold work of
187.74 ms (fast) versus 163.11 ms (small). Warm mean-query medians were 1.93 ms
versus 1.91 ms. Whole-probe p95 did not improve in this small sample. Generated
WASM shrinks from 3,677,725 to 1,852,513 bytes. The generated candidate imports
only the small compiler. Prisma schema diff reports an empty migration.

Passed: 253 focused Web mailbox, nonce, pool-client and timing tests; 7 actual
PostgreSQL nonce-concurrency and pool-timing tests; Web typecheck; frozen
lockfile, docs drift and complexity checks. No authored JS/TS functions changed.

```sh
pnpm --dir apps/web prisma:generate
pnpm --dir apps/web health-commons:generate
pnpm --dir apps/web test:prepared --run test/hosted-runtime-internal-routes.test.ts test/hosted-execution-internal-request-nonces.test.ts test/prisma-store-client.test.ts test/hosted-mailbox-fetch-timing.test.ts
pnpm --dir apps/web typecheck:prepared
# With an isolated loopback test database and MURPH_TEST_POSTGRES_CONCURRENCY=1:
pnpm --dir apps/web test:prepared --run test/hosted-callback-request-nonce-postgres-concurrency.test.ts test/prisma-store-pool-timing-postgres.test.ts
```

An optional pure-package metadata optimization was removed after it changed
runner chunk splitting and exceeded the startup chunk-count budget. Its small
local import gain did not justify broadening this Web fix or raising a budget.
The existing health-metrics behavior and manifest are restored.

## Completion and release follow-up

Implementation and focused proof are complete. PR #3914 owns the required
independent review, exact-head CI and managed Web deployment gates. The initial
CI run caught the now-removed package change; no failed gate is treated as a
pass. After promotion, inspect existing first-request, authentication and pool
timings plus unchanged typing alerts before claiming production improvement.
Completed: 2026-09-30
