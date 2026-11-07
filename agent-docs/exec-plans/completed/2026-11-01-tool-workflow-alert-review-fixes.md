# Preserve backend HTTP and late phone failure alerts

Status: completed
Created: 2026-11-01
Updated: 2026-11-01

## Outcome and boundaries

Fix the two accepted findings on the existing tool/Workflow alert branch. The
backend reader must include structurally classified reported service failures;
phone-start failure evidence must survive eight earlier turn issues. Keep
routine validation/result exclusions, privacy filtering, asynchronous diagnostics,
and bounded database work. Finish with a local commit only: no push, Ready
transition, external review submission, deployment, production mutation or email.

The current owners remain the dynamic-tool diagnostic producer, per-turn issue
collector, pending issue writer and Web aggregate monitor. The source proved the
gaps: SQL excluded every `reported_failure`, while collection and persistence
both independently truncated to eight issues. No new state owner, protocol,
dependency, schema or retry machinery is needed.

## Implementation and proof

- Include `reported_failure` with finite categories `unavailable`, `timeout`,
  `rate_limited` and `authority_rejected`. The reported authorization category
  comes from structural service HTTP status evidence. Exclude purely reported
  unknown/invalid-input/not-found/conflict results and all validation-stage rows.
- Share bounded issue admission between the turn collector and persistence:
  eight ordinary issues plus two exact `create-phone-call` dynamic-tool errors.
  Existing record shape, sanitization and best-effort scheduling remain intact;
  maximum pending writes per call rises from eight to ten with no awaited I/O
  added to tool execution.
- Test ordinary/phone ordering, independent persistence admission, saturation,
  and exclusion of validation/unrelated producer issues from reserved capacity.
- Run a synthetic app-server subprocess through the real dispatcher and turn
  collector. Eight computer HTTP 503 failures precede a phone HTTP 403 or 500
  failure. Read real pending files, insert their records into connection-local
  PostgreSQL temporary tables, and execute the real monitor SQL with no phone
  rows. Both failures must alert. The subprocess keeps engine compilation
  separate from Next environment type augmentation.
- Internal operational behavior only; no member-facing changelog or stochastic
  model journey is required. Tool contracts, model input and replies are unchanged.

## Calibration

Authorized primary-database read-only helper, exit 0. Fixed UTC interval:
2026-10-18 21:45 through 2026-11-01 21:45, with one hour of warmup. Query only
bounded aggregates and finite operation/reason/category labels; no identifiers or
private payloads leave SQL. Application timestamps are UTC by the existing
runtime issue/phone-write convention; output timestamps are explicitly formatted.

The revised predicate finds 24 dynamic-tool issues: 21 backend (17 handler
exceptions, four authority rejections) and three phone. One direct failed phone
row has no provider call ID. There are zero newly included reported backend
failures in retained data. The largest true trailing-hour count per backend
operation is three, so keep the threshold at four. The last 24-hour maximum is
two and the final-hour count is zero.

A replay across 4,033 five-minute boundaries yields zero backend incident emails
and zero reminders. Phone observations yield three incidents, zero reminders and
three recoveries. All samples are below the 10,001-row calibration guard and
production's 1,000-observation source caps. Reminder jitter cannot change these
counts because none of the incidents lasts six hours.

These are observation-based counterfactual counts, assuming timely ingestion,
healthy cron and successful delivery. Retained occurrence times do not prove
historical ingestion availability; phone rows are current state, not a transition
journal. No actual email was sent. Historical heartbeat behavior is unchanged
and was not recalibrated.

## Verification

Final focused proof: 71 Web tests across seven files and 354 Assistant Engine
tests across six files, all passed with zero skips. Both typechecks passed.
Candidate review checked the full diff, exact producer/consumer path, finite
labels, independent caps, unchanged model input and async persistence. Complexity
passes with no new debt; pre-existing Codex turn-function hotspots are unchanged.
No new repository friction entry was needed.

Commands from the checkout root (each final command exited 0):

```sh
# Emitted dependency prerequisites for the composed producer test: exit 0
pnpm --filter '@murphai/assistant-engine^...' build

# 71 tests: exit 0
MURPH_TEST_POSTGRES_CONCURRENCY=1 \
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test \
MURPH_TEST_WORKFLOW_BUILD_MANIFEST=apps/web/.next-smoke/diagnostics/workflows-manifest.json \
pnpm exec vitest run --config apps/web/vitest.config.ts \
  apps/web/test/hosted-tool-failure-monitor.test.ts \
  apps/web/test/hosted-tool-failure-health-postgres.test.ts \
  apps/web/test/hosted-workflow-heartbeat-monitor.test.ts \
  apps/web/test/hosted-runtime-latency-alert-cron.test.ts \
  apps/web/test/phone-calls-workflow-local.test.ts \
  apps/web/test/workflow-run-schema.test.ts \
  apps/web/test/next-config-workflow.test.ts

# 354 tests: exit 0
pnpm exec vitest run --config packages/assistant-engine/vitest.config.ts \
  packages/assistant-engine/test/assistant-tool-failure-diagnostics.test.ts \
  packages/assistant-engine/test/assistant-dynamic-tool-failure-boundary.test.ts \
  packages/assistant-engine/test/assistant-codex-dynamic-tool-runtime.test.ts \
  packages/assistant-engine/test/assistant-codex-computer-tools.test.ts \
  packages/assistant-engine/test/assistant-codex-ask-grok-tool.test.ts \
  packages/assistant-engine/test/assistant-codex-analyze-video-tool.test.ts

# Each exit 0
pnpm --dir apps/web typecheck
pnpm --dir packages/assistant-engine typecheck
pnpm complexity:diff
pnpm docs:drift
pnpm docs:gardening
git diff --check
```

Calibration used `murph-prod-psql-ro -X -A -t -c <SQL>` from an in-memory Python
process (both exited 0). SQL derived the operation/reason/category allowlists
from the reader source, applied the revised predicate, and returned only finite
aggregate labels/counts and five-minute health maxima. Python counted incident
transitions in memory. No connection secret or production row was persisted.

Earlier attempts: initial Web-only SQL test exited 1 because an emitted package
prerequisite was absent; the standard dependency build above resolved it.
Initial Web typecheck exited 2 when a test helper imported engine source into
Next's augmented ProcessEnv; subprocess execution fixed that boundary. Initial
docs drift exited 1 before this execution record was added. All were rerun
successfully; no failing check remains.

## Rollout and deliberate exclusions

P1 takes effect with a subsequent Web deploy. P2 is Cloudflare-hosted runtime
code and takes effect after the next runtime deploy; warm old bundles keep the
old cap until replaced. The issue schema is unchanged and old/new Web readers
accept both producer versions. No coordinated rollout or new rollback floor.
No threshold change, unrelated cleanup, production Web rebuild (Workflow/build
inputs unchanged), PR update, push, external exact-head CI/ReviewGPT, deploy or
live email. The existing prior Workflow build manifest is checked by the alert
suite but is not represented as a fresh build.
Completed: 2026-11-01
