# Harden PlanetScale database metric observability

Status: active
Created: 2026-08-15
Updated: 2026-08-15

## Goal

- Make transient PlanetScale connection-error metric omissions diagnosable and
  less page-prone without treating missing counters as zero or weakening real
  database-pressure alerts.

## Success criteria

- ReviewGPT independently inspects the existing monitor, the observed two-check
  omission, and current official PlanetScale and Cloudflare contracts.
- Persisted samples, structured warnings, and operator copy identify exactly
  which expected connection-error port observations were missing.
- The confirmation remains narrowly bounded, outside storage transactions,
  preserves unsafe-evidence priority, and has deterministic request and timing
  tests.
- Focused database-health tests and the Cloudflare typecheck pass locally.
- The exact pushed PR head passes preliminary specialists, final ReviewGPT, and
  required GitHub checks.

## Scope

- In scope: PlanetScale metric normalization and confirmation, database-health
  sample evidence, structured warnings, operator telemetry copy, focused tests,
  and their owning reliability/architecture/testing docs.
- Out of scope: changing connection-pressure thresholds, converting absent
  counters to zero, adding a new monitoring service or queue, changing Linq
  delivery ownership, or exposing raw provider responses.

## Constraints

- Technical constraints: preserve independent metric-family evaluation, per-port
  monotonic baselines, the two-minute run lease, the five-minute cron cadence,
  rollback-compatible additive SQLite state, and existing secret/redaction
  boundaries.
- Product/process constraints: use the existing Cloudflare singleton owner,
  keep the change as small as the evidence allows, use ReviewGPT plus current
  primary-source documentation, and complete the normal worktree/PR review lane.

## Risks and mitigations

1. Risk: more scrapes mask sustained observability loss or increase provider
   load without improving evidence.
   Mitigation: add at most one condition-specific confirmation only if official
   contracts and ReviewGPT support it; keep the persistent-gap page threshold.
2. Risk: additive diagnostic state breaks rollback or replays counter deltas.
   Mitigation: keep existing physical columns and schema version, parse old
   samples safely, and advance only observed per-port baselines.
3. Risk: richer logs expose signed scrape URLs or provider payloads.
   Mitigation: log only canonical metric names, expected port labels, bounded
   counts, failure codes, and attempt metadata.

## Tasks

1. Inspect the exact current owner and focused tests; research official
   PlanetScale and Cloudflare semantics.
2. Send a scoped evidence archive to ReviewGPT for root-cause and smallest-fix
   analysis.
3. Implement the accepted bounded diagnostics/retry change with regressions.
4. Update only the live owner docs whose contract changes.
5. Run focused proof and typecheck, inspect the diff, commit, push, and open the
   PR.
6. Run preliminary and final exact-head ReviewGPT concurrently with required CI,
   remediate accepted findings, and finish the PR lane.
7. Update the repository ReviewGPT toolchain to the latest public release,
   verify its dependency policy surface, and use that version for the remediated
   exact-head review.

## Decisions

- Missing provider series remain unknown rather than zero; this invariant is not
  negotiable without an explicit provider guarantee.
- The existing database-health Durable Object remains the sole owner; no new
  service, queue, database, or alert lifecycle will be introduced.
- Keep the existing one-second, two-observation confirmation rather than adding
  delay or a third call. PlanetScale's 30-second example Prometheus scrape
  configuration is not a provider freshness guarantee, while the observed gap
  already survived four scrapes across two five-minute checks. This preserves
  the four-request ceiling and a 41-second worst-case wall time under the
  two-minute lease.
- Preserve counters first observed by a safe still-incomplete confirmation in
  the original complete gauge evidence, so their per-port baseline advances and
  the next real increment is not suppressed.
- Store the exact absent expected ports in the existing per-sample evidence and
  alert-obligation JSON as bounded parsed-observation and per-port omission
  counts. Legacy JSON without that field normalizes to no port detail; warnings
  record the same exact counts without provider payloads.
- Preliminary ReviewGPT found that a mixed confirmation could select another
  missing family while retaining a prior port omission, causing strict
  persistence validation to reject the alert. Canonically union any port
  omission evidenced during the failed check into its missing-family list.
- Preserve absent legacy port evidence as unknown rather than zero. If any
  contributing check predates detailed evidence, the entire two-check window
  reports unavailable port detail instead of presenting a partial ratio as
  exact.
- Upgrade `@cobuild/review-gpt` from `0.5.127` to `0.5.131`, including the
  lockfile, release-age exception, and repository version assertion. Releases
  `0.5.128` through `0.5.131` harden canonical thread/turn capture, submitted
  attachment verification, and marked-response handling, which are directly
  relevant to the rate-limited round-two capture encountered on the remediated
  head.

## Verification

- Commands run before review: `pnpm exec vitest run --config
  apps/cloudflare/vitest.config.ts` for the four database-health node files (109
  tests),
  `pnpm exec vitest run --config
  apps/cloudflare/vitest.workers.config.ts` for the database-health Workers E2E
  file (5 tests), and `pnpm --dir apps/cloudflare typecheck`; all pass.
- `pnpm docs:drift` and `git diff --check` pass. The diff-aware lane's affected
  Cloudflare verification passes 147 node files (2,548 tests, 2 skipped) and 6
  Workers files (15 tests). Its earlier global workspace-boundary guard reports
  four base-identical violations in untouched CLI/Web tests; each reported path
  is byte-identical to `origin/main`, so the current diff did not cause them.
- After preliminary and final-round ReviewGPT remediation, the focused node
  suite passes 112
  tests, the real Workers/SQLite file passes 5 tests, and the Cloudflare
  typecheck passes. Exact-head GitHub Actions were fully green on the first
  candidate head.
- Commands still to run: final ReviewGPT remediation review and exact-head
  GitHub Actions for the dependency-updated remediated head.
- ReviewGPT `0.5.131` is installed and reports the expected version;
  `pnpm deps:guard`, `pnpm deps:ignored-builds`, and `pnpm install
  --frozen-lockfile` pass. `pnpm deps:audit` remains non-green on the repository's
  existing advisory backlog; the reported ReviewGPT path resolves the same
  `repomix@1.16.0` and `tar@7.5.16` on the parent head, and this bump changes no
  transitive lockfile resolution.
- The focused repository contract for the installed ReviewGPT runner passes.
  A whole-file CLI audit passes 42 tests with 1 skipped, while three unrelated
  shell-harness cases exceed their existing 45/60-second limits under concurrent
  ReviewGPT activity on the shared host. A direct dry run returns the expected
  output successfully in 66 seconds, confirming host latency rather than an
  assertion or exit-status regression; exact-head GitHub Actions own the clean
  broad rerun.
- Expected outcomes: omitted ports are explicit across restart and alerts,
  complementary port observations compose safely, unsafe evidence is not
  delayed, retry/request bounds are fixed, legacy persisted rows remain
  readable, and all routed checks pass.
