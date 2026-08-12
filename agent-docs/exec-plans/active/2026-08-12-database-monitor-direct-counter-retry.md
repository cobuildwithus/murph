# Reduce direct-counter telemetry flapping

Status: active
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
- Preliminary specialists, final ReviewGPT, and exact-head CI remain pending on
  the pushed PR candidate.
