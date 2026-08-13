# Separate hosted device sync schedule ownership

Status: active
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Stop hosted device-sync continuation work from rewriting the Web-owned
  provider reconciliation deadline and re-entering the global due-reconcile
  sweep, so foreground replies no longer inherit avoidable snapshot churn and
  runner replacement latency.

## Success criteria

- A queued local device-sync job may keep an earlier runtime wake without
  shortening the provider account's canonical `nextReconcileAt` projection.
- A cold replacement re-admits the exact accepted obligation even though the
  machine-local job store is not snapshotted: job kind, payload/window, dedupe
  identity, retry authority, and remaining work remain equivalent.
- Connection-established work, dirty resource work, and ordinary scheduled
  reconciliation each retain one existing durable owner until their own
  terminal condition.
- Provider-derived schedule changes still reach the Web control plane.
- Focused regression tests prove both ownership boundaries.
- A direct R2 upload failure preserves only a bounded, redacted provider error
  code, message, and request id in the existing snapshot-failure diagnostics.
- The public changelog describes the member-visible reply-latency recovery
  without exposing private incident evidence or internal identifiers.
- Relevant package tests and typecheck pass, required exact-head CI is green,
  and the routed ReviewGPT gates return no unresolved findings.

## Scope

- In scope:
  - Hosted device-sync control-plane schedule projection.
  - Runtime-local queued-job wake preservation and cold-replacement recovery.
  - Reuse of the existing encrypted system mailbox and Web dirty rows for exact
    accepted-work recovery.
  - Secret-safe diagnostics for direct R2 upload failures.
  - Focused tests and durable owner documentation.
- Out of scope:
  - New schedulers or queues.
  - Provider retry policy and artifact-upload error classification owned by a
    separate active task.
  - R2 upload retry behavior; reducing the self-exciting snapshot load is the
    proven root correction for this incident.

## Constraints

- Technical constraints:
  - Web remains the canonical owner of provider reconciliation facts.
  - The machine-local job store is an execution cache, not the only durable
    owner of accepted hosted work.
  - Foreground conversation work retains priority over background sync.
- Product/process constraints:
  - Preserve accepted device-sync work and existing provider cadence.
  - Avoid overlapping the active artifact-retry task's production paths; keep
    the regression in a distinct reconciliation section of the shared test.

## Risks and mitigations

1. Risk: Removing the combined minimum could strand queued local work after a
   cold replacement because the device-sync SQLite store is machine-local.
   Mitigation: Keep the exact source obligation in its existing durable mailbox
   or dirty-row owner until terminal completion, and prove a real v2
   checkpoint/restore path.
2. Risk: Provider schedule updates could stop propagating.
   Mitigation: Cover a changed provider-owned deadline in the same focused
   control-plane test.
3. Risk: Retaining one device-sync obligation could block unrelated connections.
   Mitigation: Preserve per-connection order while allowing another connection's
   due mailbox item to run; add focused ordering coverage without adding a new
   queue or scheduler.

## Tasks

1. [completed] Read the current runtime, Web authority, sweeper, and schedule contracts.
2. [completed] Add a focused failing regression for distinct provider and local-job wakes.
3. [completed] Run and record the required anomaly retrospective before further remediation.
4. [completed] Delete the insufficient recovery timestamp, capability, migration, and
   generic cold-re-admission path.
5. [completed] Retain exact accepted work in the existing durable owner until terminal
   completion, including connection-established and dirty resource work.
6. [completed] Prove exact recovery through a v2 checkpoint that excludes device-sync SQLite.
7. [completed] Update durable runtime/reliability documentation for the ownership rule.
8. [completed] Add bounded, redacted R2 error code, message, and request-id
   diagnostics without retaining response bodies or presigned URL material.
9. [completed] Scope hosted provider scheduling to the mailbox connection, derive
   retained work from actual queued/running rows including worker children, and
   fence provider-cadence publication behind a durable terminal checkpoint.
10. [in progress] Run focused tests, typecheck, parent diff review, PR CI, and ReviewGPT gates.

## Decisions

- Use the existing runtime-local wake computation and provider scheduler; do not
  add a queue or another scheduler.
- The first reviewed shape deleted the local/global minimum but lacked cold
  recovery. The second shape added a timestamp projection, capability, migration,
  and restore branch, but a timestamp cannot preserve the accepted operation.
- Delete that projection machinery. A retry time is not a durable obligation.
- Reuse the existing encrypted system mailbox for exact connection-established
  and scheduled wake authority, and retain Web dirty rows for dirty resource
  work until their terminal acknowledgements. Local SQLite remains the bounded
  execution cache.
- Before checkpoint publication, query the owned account's actual queued and
  running rows, shape every payload through the provider manifest, and replace
  each attempt limit with the exact remaining count. This captures
  worker-created children and excludes local-only fields. The retained mailbox
  remains the only durable source; this transition does not introduce a second
  job owner.
- Admit provider cadence only from a connection mailbox wake and only for its
  mapped local account. A retained job wake and a generic runtime timer never
  run the provider scheduler. Carry the advanced provider cadence in the
  retained wake, withhold it from Web while work remains, and use one empty-job
  completion-fence checkpoint before publishing the terminal cadence.
- Order retained device-sync work by connection id so one connection's retry
  delay cannot block due work for another while same-connection FIFO remains
  intact.
- Reject a new durable job mirror, queue, scheduler, or snapshot inclusion of
  credential-bearing device-sync SQLite.
- Reuse the existing `checkpoint.snapshot_failed` error-cause diagnostics for
  R2 failures. Parse only the standard XML error code, message, and request id;
  bound and redact them before attaching them to the error chain, and never
  retain the raw response body, resource path, or presigned request material.

## Verification

- Commands to run:
  - Focused assistant-runtime Vitest coverage for the new schedule-owner test.
  - Assistant-runtime package typecheck.
  - Durable-doc drift check for the owner-contract update.
  - Cloudflare runner-platform coverage for bounded and redacted R2 failure
    diagnostics.
  - Required GitHub checks on the exact PR head.
- Expected outcomes:
  - The provider deadline remains unchanged when a local queued job wakes
    sooner, while the runtime's next wake still selects that local job.
  - A cold runtime restores the exact accepted operation and remaining retry
    authority from its existing durable owner, not from a generic timestamp.
  - A provider-derived schedule change is still sent to Web.
  - No new dependency, scheduler, or queue is introduced.
