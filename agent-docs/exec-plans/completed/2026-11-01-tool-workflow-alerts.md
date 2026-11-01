# Tool backend and Workflow heartbeat email alerts

Status: completed
Created: 2026-11-01

## Outcome and invariants

Detect tool backend failures and a Workflow engine that cannot complete even
without product traffic. Reuse operational incident email delivery, configuration,
and the five-minute cron. No member identifiers, content, provider errors, or
production mutations. This task ends at a verified local commit; no push or PR.

## Owners and evidence

The cron currently has no dynamic-tool or Workflow completion monitor. Runtime
issues own tool failures; phone-call rows own provider-start state. Existing
issue-kind/time and call-status/time indexes cover bounded reads. The existing
HostedLinqAlert owner can hold a fixed heartbeat state row and separate incident
rows, avoiding new tables, migrations, and Workflow-owned alert delivery.

## Design

- Separate phone and other-tool incidents so baseline noise cannot hide a phone
  failure. One phone failure or direct-member failed start in one hour alerts.
- Other handler/backend failures alert at four per operation per hour. Exclude
  argument validation. Finite operation/category allowlists protect email output.
- Heartbeat is one pure step. Cron persists start intent before calling v5 start,
  polls completion outside Workflow, and alerts at 30 minutes without completion.
  Compare-and-set state prevents concurrent starts; retries cannot reset age.
  Start at most every 15 minutes; replace pending runs only after their deadline.
- Reuse six-hour reminders, quiet-hour bypass, recovery, send leases and retries.
  Email configuration remains unchanged. No foreground or assistant behavior edits.
- No database transaction spans an external request. Bound SDK waits and reads;
  late work has no product effects and cannot overwrite newer state.

## Verification

Focused monitor/cron tests, real local Workflow compilation and execution, Web
typecheck, production Next build with the Vercel world, complexity and diff review.
Read-only calibration and replay emit only aggregates. Historical heartbeat
completion did not exist: report that replay gap without inventing observations.
Internal operational change: no public changelog. Production rollout is separate.

## Progress

- Created isolated requested checkout; installed frozen dependencies (exit 0).
- Verified UTC timestamp convention from the runtime diagnostic owner.
- Implemented two monitors and three independent incident identities; retained the
  existing email configuration and incident owner unchanged.
- Parent review: SQL indexes, privacy allowlists, sample saturation, bounded call
  counts, concurrent start claims, immutable outage deadline, late-result fencing,
  email retry/idempotency and cron sibling draining inspected. No known findings.
- Internal operational behavior only; no assistant/provider input, member-facing
  UI or hot-reply-path change, so no live assistant journey or public changelog.
- No new schema, migrations, packages or dependencies. No Frog entry was needed;
  cold-checkout build prerequisites were prepared through the standard package build.

## Calibration and replay

Read-only primary-database queries used a fixed UTC end of 2026-11-01 21:35 and
14-day start of 2026-10-18 21:35, with one preceding hour for trailing-window
warmup. Timestamp-without-timezone values were explicitly formatted as UTC by
the documented application convention. No identifiers or content were selected.

There were 24 qualifying dynamic-tool failures: three phone failures and 21
non-phone failures (17 handler exceptions and four authority rejections). One
direct-member phone row had failed without a provider ID. The maximum trailing
hour for one other operation was three; a threshold of four stays above that
baseline. The sampled 24-hour baseline remained below the per-operation threshold.

The replay evaluated 4,033 five-minute boundaries, independently capped source
reads at 10,000 matching observations, and used the production operation allowlist,
failure predicates, one-hour window, per-operation threshold and reminder jitter.
Assuming timely ingestion, a healthy cron and successful email delivery:

- Phone: three incident emails, zero reminders, three healthy transitions. First
  emails: Oct 30 13:25, Oct 31 22:30, Nov 1 17:40 UTC. The phone row and tool issue
  on the final day coalesce into one incident.
- Other tools: zero incident emails and zero reminders.
- Heartbeat: historical replay is unavailable, not zero alerts. Production has
  zero matching heartbeat state/incident rows, and no historical probes existed.
  A synthetic three-day dead-engine replay through the actual incident owner
  sends 12 emails: one initial alert at minute 30 and 11 reminders.

Replay limitations: retained issue timestamps describe occurrence, not historical
cron ingestion availability. Phone rows expose current status and latest update,
not a transition journal. Consequently this is an observation-based counterfactual,
not proof of actual historical email delivery. No Vercel telemetry or production
Workflow starts were requested. SQL and local replay subprocesses exited 0.

## Exact verification commands and exits

All commands run from the task checkout. Build values are synthetic. The final
focused command exercises real SQL in connection-local temporary tables, compiles
and executes the real one-step Workflow, and verifies the production build manifest.

```sh
# Exit 0
pnpm install --frozen-lockfile

# Exit 0: standard emitted dependency prerequisites for the fresh checkout
pnpm --filter @murphai/hosted-execution... build

# Exit 0: 59 tests, seven files, zero skips
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

# Exit 0
pnpm --dir apps/web typecheck

# Exit 0: 22 steps, four Workflows, 429 static pages, trace/relocation checks
WORKFLOW_TARGET_WORLD=vercel \
VERCEL_DEPLOYMENT_ID=dpl_synthetic_tool_workflow_alerts \
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:1/murph_test \
NEXT_TELEMETRY_DISABLED=1 pnpm --dir apps/web build:hosted-local

# Each exited 0
pnpm complexity:diff
pnpm docs:drift
pnpm docs:gardening
git diff --check
```

Earlier attempts: standalone Web typecheck exited 2 on a test-only union access;
the assertion was corrected, then all final checks above passed. The first exact
build command exited 1 before Next compilation because the fresh checkout lacked
`@murphai/hosted-execution/dist/env.js`; the package-chain build above resolved
that prerequisite. Initial narrower tests exited 0; they were superseded by the
complete focused command after the final test and message-size changes.

The production read helper was invoked as `murph-prod-psql-ro -X -c <SQL>` for
bounded aggregate/index inspection and `murph-prod-psql-ro -X -A -t -c <SQL>`
from an in-memory Python replay for machine-readable finite health samples. Both
used existing Keychain-backed read-only access; no connection secret was read or
persisted. The replay derived safe operation/reason literals from the monitor
source and grouped only booleans/counts by five-minute boundary before output.

## Deliberate exclusions and handoff

No push, PR, ReviewGPT submission, deployment, live email, production mutation,
or old Workflow repair. External exact-head CI and deployed behavior remain
unverified because this task explicitly ends at a local commit. No historical
heartbeat numbers are fabricated. Primary database, cron and Resend failure
monitoring remain external dependencies of the existing alert owner. Rollout and
post-deploy inspection are documented in the Web README and require a later task.

Updated: 2026-11-01
Completed: 2026-11-01
