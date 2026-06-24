Goal (incl. success criteria):
- Add clean hosted ingress latency diagnostics for the gap between web Temporal signal acceptance and Cloudflare runtime ensure-processing acceptance.
- Success means future `hosted_ingress_latency_trace.phase_breakdown_json` can split the opaque pre-Cloudflare wake interval into Temporal Activity start/fetch and Cloudflare ensure-processing route/DO milestones without storing payloads, prompts, transcripts, secrets, or direct identifiers.

Constraints/Assumptions:
- Web remains owner of mailbox and latency trace facts.
- Temporal remains pointer-only orchestration state; no raw payloads or workflow command-order changes.
- Cloudflare remains the execution adapter; diagnostics must not create a second wake path or scheduler.
- Observability must stay metadata-only and avoid adding blocking writes to the user-visible reply hot path.
- Preserve unrelated active ledger rows and avoid the active hosted-ingress wake repair working set where possible.

Key decisions:
- Extend the existing latency phase-breakdown diagnostic instead of adding another table.
- Stamp diagnostics from the Temporal Activity and Cloudflare ensure-processing adapter path, not the replay-sensitive workflow command sequence.

State:
- In progress.

Done:
- Confirmed the missing current gap is Temporal signal accepted -> first Cloudflare ensure-processing event.
- Read hosted runtime, Temporal, reliability, security, and workflow docs.

Now:
- Inspect the existing latency store and ensure-processing request/response contracts.

Next:
- Patch the smallest instrumentation seam and focused tests.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/hosted-orchestrator-temporal/src/activities/ensure-runtime-processing.ts
- packages/hosted-orchestrator-temporal/src/activities/http-client.ts
- apps/cloudflare/src/worker/route-handlers/runtime-control.ts
- apps/cloudflare/src/user-runner/hosted-user-runner.ts
- apps/web/src/lib/hosted-runtime-latency/store.ts
- Relevant focused tests under apps/web/test, apps/cloudflare/test, packages/hosted-orchestrator-temporal/test.
Status: completed
Updated: 2026-06-24
Completed: 2026-06-24
