# Reduce mailbox cold startup cost

Status: active
Created: 2026-09-29
Updated: 2026-09-29

## Outcome and evidence

Reduce real message admission latency while preserving signature verification,
one-use nonces, fresh access checks, runtime fencing, and existing typing timing.
Private production evidence localizes this incident to a fresh Web mailbox
handler and its first database operation; the runner control call was prompt.
Platform time before handler entry remains partly unattributed.

## Architecture and scope

The existing Web route, Prisma client generator, and package bundler own this
path. Measure the supported small Prisma compiler against the default and check
whether unused metric catalogs can be removed from mailbox module loading.
Keep only measured improvements. No service, cache, scheduler, warmup traffic,
new state owner, protocol change, or alert suppression. Do not change unrelated
in-progress messaging work.

## Product UX

Outcome: Reduce startup work before admitted messages can execute.
Reaches: Warm and cold workspaces whose Web callback reaches a fresh instance.
Proof: Fresh-process before/after measurements, actual local database reads,
existing mailbox/auth tests, package tests, typechecks and production timing.
Do not claim a fixed end-to-end deadline from a local benchmark.

## Tasks

- [x] Trace latest alert through ingress, control RPC, runtime import and Web logs.
- [x] Reproduce compiler startup cost with isolated generated clients.
- [x] Measure and remove unnecessary package loading; retain only useful changes.
- [ ] Run focused correctness checks, typechecks, parent review and exact-head gates.
- [ ] Record deployment evidence and remaining platform latency limits.

## Failure and deployment

Build-only choices preserve database schema, wire shapes and authority.
No database migration or coordinated Worker rollout is needed for a Web-only
compiler change. Retain package behavior for callers that use metric catalogs.
Warm execution must not materially regress. Inspect fresh-instance callback
measurements after deployment; a smaller artifact cannot guarantee platform
scheduling or network latency.

## Verification so far

Twenty alternating fresh-process runs per compiler against the local database
and a synthetic missing-member nested projection: median total cold work
187.74 ms (fast) versus 163.11 ms (small); warm mean-query medians 1.93 ms versus
1.91 ms. End-to-end local p95 did not improve in this small sample, so it is not
evidence of a tail-latency guarantee. Generated WASM shrinks from 3,677,725 to
1,852,513 bytes. No production data was used in the benchmark.


The health-metrics package performs only module-local initialization. Marking
it side-effect-free removes unused catalogs from the mailbox bundle without
changing the exports used by other consumers. Fifteen alternating fresh-process
route-import samples (after one discarded pair) measured 124.87 ms median before
and 119.12 ms after; unminified esbuild output shrank from 880,688 to 758,960 bytes.
This is a Node/esbuild experiment, not a Next or Vercel startup measurement.

Focused checks passed: health-metrics tests (55) and typecheck; Web mailbox,
nonce, pool-client and timing tests (253); actual PostgreSQL nonce concurrency
and pool timing tests (7); Web typecheck. The generated current client was
inspected and uses the small compiler, with no fast-compiler import.

Commands:

```sh
pnpm --dir packages/health-metrics test
pnpm --dir packages/health-metrics typecheck
pnpm --dir apps/web prisma:generate
pnpm --dir apps/web health-commons:generate
pnpm --dir apps/web test:prepared --run test/hosted-runtime-internal-routes.test.ts test/hosted-execution-internal-request-nonces.test.ts test/prisma-store-client.test.ts test/hosted-mailbox-fetch-timing.test.ts
pnpm --dir apps/web typecheck:prepared
# With an isolated loopback test database and MURPH_TEST_POSTGRES_CONCURRENCY=1:
pnpm --dir apps/web test:prepared --run test/hosted-callback-request-nonce-postgres-concurrency.test.ts test/prisma-store-pool-timing-postgres.test.ts
```

Parent candidate review: no database shape, protocol, request count, ordering,
authority, provider input, or alert classification changes. No new dependencies
or runtime state. Production tail-latency improvement remains unverified.
