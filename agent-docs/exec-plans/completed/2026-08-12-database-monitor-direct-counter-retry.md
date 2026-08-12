# Reduce direct-counter telemetry flapping

Status: completed
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Absorb a transient omission of PlanetScale's direct connection-error counter
  without weakening database-pressure paging, missing-telemetry detection, or
  the direct migration admission-failure signal.

## Success criteria

- A safe partial scrape that is missing only the direct-error counter receives
  one bounded same-run retry before it contributes to monitoring-failure state.
- Any concrete condition available on the first scrape still pages immediately
  without waiting for a retry.
- A recovered direct-error counter still advances its baseline and pages on a
  positive delta.
- A failed or still-incomplete confirmation preserves the original partial
  observation, and two consecutive exhausted checks retain the existing
  telemetry-only page.
- Focused Node and Workers-runtime tests, Cloudflare typecheck, required guards,
  ReviewGPT gates, and exact-head CI pass.

## Evidence and constraints

- The parser distinguishes an absent counter family from a present zero-valued
  counter. The confirmation path must preserve that distinction when family
  presence changes between bounded scrapes.
- Missing values remain unknown; no omission is converted to zero.
- The Cloudflare singleton, five-minute cron, two-check telemetry threshold,
  immediate concrete-pressure admission, hourly provider fence, exact-body
  retry, two-destination fan-out, and SQLite state owner remain unchanged.
- No new queue, scheduler, fallback service, credential, threshold, or durable
  state is introduced.

## Tasks

1. Add failing unit and Workers-runtime regressions for transient direct-counter
   omission, immediate available pressure, recovered positive deltas, and
   persistent incomplete telemetry.
2. Add one monitor-owned partial-confirmation path that evaluates every retry
   signal, recovers the missing direct counter, and otherwise preserves the
   first observation.
3. Update the database-monitor owner contracts and verification map.
4. Run focused verification, inspect the complete diff for privacy and alert
   regressions, commit, push, and open the PR.
5. Run the preliminary specialist and sensitive final ReviewGPT gates
   concurrently with exact-head CI, resolve accepted findings, and close the
   plan through the scoped final commit.

## Deployment

- Cloudflare Worker only. No Web or Temporal ordering, migration, or container
  drain is required. After rollout, verify a successful scheduled sample and
  the absence of repeated direct-counter-only telemetry pages while retaining
  direct-error delta and persistent-gap coverage.

## Verification

- Focused Node database-health suites passed: 3 files, 82 tests.
- The real Workers-runtime database-health suite passed: 1 file, 3 tests.
- Cloudflare typecheck, log-payload guard, documentation drift check,
  `git diff --check`, and the changed-file identifier scan passed.
- The preliminary specialist pass accepted the operator-experience shape and
  identified one coverage-only gap. Its inspected test patch added the two
  missing family-shape boundary cases; the final Node slice passed 3 files and
  84 tests, and the Workers-runtime suite still passed 1 file and 3 tests.
- Final ReviewGPT round 1 returned `ROUND_OUTCOME: PASS` with no findings after
  verifying the bounded retry, immediate unsafe-signal path, recovered delta,
  persistent-gap page, and unchanged state and delivery contracts.
- The changed Cloudflare app's full verification passed locally: 141 Node files
  with 2,414 passing tests and 2 skips, plus 5 Workers files with 12 passing
  tests. Cloudflare also passed its exact-head CI tests. The umbrella app shard
  failed only in the unchanged Web Next.js build while resolving an internal
  Google-font module; the failed target is outside this patch.

Completed: 2026-08-12
Completed: 2026-08-12
