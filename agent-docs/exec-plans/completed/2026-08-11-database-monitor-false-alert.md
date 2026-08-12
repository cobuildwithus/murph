# Diagnose and correct database monitor false alerts

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Determine why the production database-health monitor reported two fully
  unavailable telemetry checks ending at 00:35 UTC even though Postgres stayed
  available, then prevent that proven non-database failure from producing a
  misleading operator page without weakening genuine pressure or monitoring
  outage detection.

## Success criteria

- The two production samples are classified to the narrowest available failure
  boundary using Durable Object state, Cloudflare metadata logs, provider
  evidence, configuration, or a production-faithful reproduction.
- A focused failing test reproduces the proven cause before the correction.
- Genuine database-pressure conditions still page immediately and persistent
  telemetry loss still becomes visible with truthful actionable copy.
- The proven transient or non-actionable condition no longer pages as though an
  operator needs to investigate the database.
- Focused Cloudflare tests, package typecheck, direct scenario proof, required
  ReviewGPT gates, and exact-head CI pass.

## Scope

- In scope: the Cloudflare-owned PlanetScale database-health collector, failure
  classification/admission, bounded diagnostics, focused tests, and matching
  reliability/deploy documentation when behavior changes.
- Out of scope: database tuning, production schema changes, Web or Temporal
  runtime behavior, disabling the monitor, broad provider fallbacks, or a new
  alerting service/state owner.

## Constraints

- Technical constraints: preserve per-family unknown handling, immediate
  concrete-pressure alerts, exact-body/idempotent Linq retry, hourly provider
  pacing, bounded metadata-only persistence, and the existing SQLite singleton
  owner. Do not infer a database outage from telemetry absence.
- Product/process constraints: diagnose from evidence before editing behavior;
  use the isolated worktree/PR lane; run focused proof before external review;
  complete the preliminary specialist and sensitive final ReviewGPT gates,
  exact-head CI, parent final review, and scoped plan-closing commit.

## Risks and mitigations

1. Risk: suppressing a real monitor outage hides the loss of database-pressure
   visibility.
   Mitigation: distinguish only the proven failure class and retain a truthful,
   actionable path for persistent telemetry loss.
2. Risk: the production sample evidence is inaccessible after the event.
   Mitigation: exhaust current Durable Object/log/provider paths, then add the
   smallest metadata-only probe needed to classify a fresh recurrence before
   changing admission semantics.
3. Risk: a provider/API contract drift fix becomes bespoke infrastructure.
   Mitigation: confirm the current official Cloudflare and PlanetScale
   contracts and reuse the existing discovery, scrape, SQLite, and page owners.

## Tasks

1. Recover the exact 00:30 and 00:35 UTC sample failure codes and surrounding
   provider/config/deployment evidence.
2. Trace and reproduce the proven failure through the current collector and
   alert-admission code, adding a failing focused regression.
3. Implement the smallest correction and update owner docs only where the
   operational contract changes.
4. Run focused Cloudflare unit/Workers-runtime proof, typecheck, privacy/log
   guards, and inspect the complete diff.
5. Commit and push the candidate, open the PR, run preliminary specialists and
   the sensitive final ReviewGPT gate concurrently with CI, resolve accepted
   findings, perform parent final review, and close the plan.

## Decisions

- Treat the original alert as a monitoring-path symptom. Production Postgres
  uptime and minute-by-minute writes disprove a sustained database outage but
  the retained operator copy does not expose which fully unavailable telemetry
  boundary failed.
- Treat the false-positive mechanism as the single-shot collection policy: one
  failed upstream attempt represented an entire five-minute check, and two
  point failures admitted a page without database evidence. The alert chats had
  no hourly recurrence and a later live scheduled check completed without a
  collection warning, proving the failure was transient rather than persistent
  configuration drift.
- Preserve the two-check persistent-outage threshold and every immediate
  concrete-pressure path. Retry a fully unavailable collection once after one
  second before it can increment the consecutive-failure state; keep partial
  observations single-pass so available pressure evidence is not delayed.

## Evidence

- The production database postmaster remained continuously up across the alert
  window, and bounded aggregate queries showed successful control-plane writes
  in every minute from 00:30 through 00:39 UTC.
- Runtime-log aggregates in the same window showed ordinary traffic and no
  database-error spike. The alert text itself proves neither check produced a
  partial metric observation or concrete database-pressure evidence.
- The same operator chats received the 00:35 UTC page but no hourly database
  monitor recurrence. A live Worker tail through the 03:50 UTC cron produced no
  database-health collection warning, consistent with recovery.
- Static tracing proves all discovery, target, scrape, and parse exceptions
  currently share the same two-run page admission, with one upstream attempt
  per run and no intra-run retry.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts
  apps/cloudflare/test/database-health-monitor.test.ts --no-coverage`: 66 tests
  passed, including transient-retry recovery, immediate concrete pressure from a
  successful retry, and persistent exhausted-retry paging.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts
  apps/cloudflare/test/database-health-worker.test.ts
  apps/cloudflare/test/database-health-metrics.test.ts --no-coverage`: 8 tests
  passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.workers.config.ts
  apps/cloudflare/test/workers/database-health-e2e.test.ts --no-coverage
  --passWithNoTests`: Workers-runtime scheduled path passed.
- `pnpm --filter @murphai/cloudflare-runner typecheck`: passed.
- `pnpm logs:guard`: passed; no unredacted health/model/vault payload log calls.
- `git diff --check` and changed-file identifier scan: passed.
Completed: 2026-08-11
