Goal (incl. success criteria):
- Land the hosted runtime processing wake fix and the minimal observability slice:
  short-lived `ensureRuntimeProcessing`, signal-interruptible runtime rechecks,
  scalar workflow status diagnostics, web demand-decision logs, Temporal
  activity observation, active write-fence reason persistence, and one internal
  composed per-user orchestration status route.

Constraints/Assumptions:
- Temporal is the only component that decides when Cloudflare should process.
- Cloudflare owns only making runtime processing active by starting, waking, or
  accepting a pending wake.
- Logs/status must be metadata-only; no payloads, prompts, transcripts, secrets,
  local paths, or direct personal identifiers.
- Preserve unrelated dirty files and existing active ledger rows.

Key decisions:
- Use existing query/status/demand/runner primitives; no new dashboard, event
  arrays, OpenTelemetry, or Temporal Search Attributes.
- Keep status additions scalar and bounded.

State:
- Active plan: `agent-docs/exec-plans/active/2026-05-21-hosted-runtime-processing-observability.md`.
- Runtime-processing fix and minimal observability implementation are in the
  working tree. Focused typecheck and focused tests passed for changed hosted
  execution, Temporal, Cloudflare, and web surfaces.

Done:
- Read required repo routing, security, reliability, verification, hosted
  Temporal, hosted runtime protocol, app READMEs, Temporal skill references,
  and current Cloudflare docs for Durable Object alarms/logging.
- Created active execution plan and coordination-ledger row.
- Added the `ensureRuntimeProcessing` contract/parser/activity route while
  keeping legacy ensure-execution compatibility for deploy skew and workflow
  replay.
- Made Cloudflare processing acceptance short-lived for start, replacement,
  wake, and startup-pending paths.
- Added signal-interruptible Temporal rechecks, scalar workflow status fields,
  demand-decision logs, the activity observation wrapper, persisted active
  write-fence reason, and the composed internal status endpoint.
- Updated focused tests and hosted runtime docs.

Now:
- Run final verification/audits and finish with a scoped commit if unrelated
  dirty work does not block it.

Next:
- Complete required audits, final test/typecheck pass, and scoped finish-task
  commit or report the exact dirty-work blocker.

Open questions (UNCONFIRMED if needed):
- Whether the repository finish script can safely commit only this plan's files
  is UNCONFIRMED because unrelated dirty files are present.

Working set (files/ids/commands):
- Likely files: `packages/hosted-execution/src/orchestration-control.ts`,
  `packages/hosted-execution/src/parsers/orchestration-control.ts`,
  `packages/hosted-orchestrator-temporal/src/**`,
  `apps/cloudflare/src/user-runner.ts`, `apps/cloudflare/src/user-runner/**`,
  `apps/web/app/api/internal/hosted-orchestration/users/**`,
  `apps/web/src/lib/hosted-orchestration/**`, hosted runtime docs/tests.
