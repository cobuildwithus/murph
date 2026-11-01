# Count specialized tool failure classifications

Status: completed
Created: 2026-11-01
Updated: 2026-11-01

## Outcome and boundaries

Fix the accepted round-1 finding on PR #4419 at its existing Web health reader.
The old component/error-code predicate misses group HTTP 503 and timeout
classification rows. Keep the existing incident owner, independent 1,000-row
samples, finite privacy filters, phone exclusion and four-per-tool threshold.
Local commit only; no push, Ready transition, external review, deployment,
production mutation or email. Read-only aggregate calibration is authorized.

## Implementation and producer audit

- Admit shared `diagnosticRole: classification` rows with finite issue kinds
  `tool_error` and `timeout`, preserving the existing backend reason/category
  rules and validation/refusal exclusions. The existing issue-kind/time index
  still bounds admission. No producer diagnostics or monitor are added.
- Generic operations retain their registered labels. Normalize action-specific
  `assistant.group-tool` rows to `group-tool` and
  `assistant.workout-card-editor` rows to `workout-card-editor`.
- These are the specialized issue producers returned by the dynamic dispatcher.
  `assistant.tool` is separately derived from tool-failed events without the
  shared classification role. It remains excluded, as do codex-action completion
  rows, so generic failures are not double-counted. Unknown labels retain the
  existing `other_tool` privacy bucket.
- No member-visible behavior, tool contract, prompt, foreground work or producer
  schema changes. No changelog or stochastic model journey is needed. Query
  count, concurrency, sample cap, threshold and incident ownership are unchanged.

## Regression and review

Run real group dispatch and diagnostic enrichment with synthetic HTTP 503 and
transport-timeout errors at the hosted request port. Persist via the real issue
writer, read pending records, insert them into connection-local PostgreSQL tables,
and evaluate the real health SQL. Two different actions share one tool label:
three observations remain healthy; four become anomalous. The actual monitor
with a synthetic email transport sends once across two polls. State persistence
is mocked at the existing port; no real email is sent.

The tests also retain expected-refusal and private-value exclusion checks, cover
workout normalization, and exclude completion/unclassified legacy rows. Both
real group cases failed against the original SQL with zero counted observations.
Candidate review checked the complete diff, producer identities, finite labels,
index admission, caps, privacy and the unchanged incident owner.

## Read-only calibration

UTC window: 2026-10-18 22:05 through 2026-11-01 22:05, plus one hour of warmup.
The producer normalizes occurrence times with `toISOString`; Web persists
`new Date(record.occurredAt)`. PostgreSQL timestamps are interpreted using that
UTC application convention, with explicit UTC SQL formatting.

The revised rules admit 21 backend observations, including zero newly admitted
specialized observations in retained data. Counts by finite operation:
assistant-configuration 1, automation 5, connected-apps-execute 9, group 2,
react-to-message 1, send-vault-file 3. The exact maximum trailing-hour count per
operation is three; the final 24-hour maximum is two; the final hour is zero.
Keep the threshold at four. All samples are below the 10,001-row calibration
guard and live 1,000-row cap.

A replay across 4,033 five-minute boundaries predicts zero backend incident
emails, zero reminders and zero recoveries. Reminder jitter is irrelevant with
no incidents. These counterfactual counts assume timely ingestion and healthy
cron/delivery; retained occurrence times do not establish historical ingestion
availability. No actual email was sent. Phone and heartbeat behavior is unchanged.

The local scratch calibration script derives the admission SQL and finite labels
from the reader source, performs two aggregate-only queries through
`murph-prod-psql-ro -X -A -t -v ON_ERROR_STOP=1` (SQL on stdin, 30-second timeout),
and keeps results in memory. It never prints or persists member identifiers,
raw issue rows, private payloads or database credentials.

## Verification

Final commands from the checkout root; each exits 0:

```sh
# 75 Web tests, seven files, zero skips
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

# 468 Assistant Engine tests, seven files, zero skips
pnpm exec vitest run --config packages/assistant-engine/vitest.config.ts \
  packages/assistant-engine/test/assistant-codex-group-tool.test.ts \
  packages/assistant-engine/test/assistant-tool-failure-diagnostics.test.ts \
  packages/assistant-engine/test/assistant-dynamic-tool-failure-boundary.test.ts \
  packages/assistant-engine/test/assistant-codex-dynamic-tool-runtime.test.ts \
  packages/assistant-engine/test/assistant-codex-computer-tools.test.ts \
  packages/assistant-engine/test/assistant-codex-ask-grok-tool.test.ts \
  packages/assistant-engine/test/assistant-codex-analyze-video-tool.test.ts

pnpm --dir apps/web typecheck
pnpm --dir packages/assistant-engine typecheck
python3 .tmp/tool-alert-review/calibrate.py 2026-11-01T22:05:00+00:00
pnpm complexity:diff
pnpm docs:drift
pnpm docs:gardening
git diff --check
```

Exit codes were captured explicitly. Complexity adds no debt; reported engine
hotspots belong to unchanged branch work. The Workflow manifest is the existing
prior build, not a fresh build claim. No broad acceptance or production build is
needed for this SQL-reader fix.

Earlier attempts: PostgreSQL regression exited 1 first for a fixture request
shape error, then for the four expected red tests against old SQL. Engine
typecheck exited 2 for a missing fixture context field, then passed after its
correction. Calibration's first SQL query exited 0 but its local multiline-JSON
parser exited 1; corrected parser and both final SQL queries exited 0. Docs
drift exited 1 before this execution record was added. All checks were rerun
successfully. No new repository friction was identified.

## Rollout and remaining gates

This is a backward-compatible Web reader change; existing persisted classified
producer rows are sufficient. A later Web deploy activates the fix. No runtime
producer deploy, schema migration or coordinated rollout is needed. Reverting
the reader restores the previous blind spot but does not alter stored data.
New-head CI and ReviewGPT remain for the separately authorized push/review step.
Completed: 2026-11-01
