# Retire Persistent Hosted Runtime Wakes

Status: active
Updated: 2026-08-19

## Goal

Eliminate repeated successful no-op hosted-runtime invocations while preserving
real scheduled work, foreground mailbox priority, and the existing ownership
boundaries between Web, Temporal, and the Cloudflare runtime.

## Production Evidence

- The previously deployed cross-mode controller correction and exact new runner
  bundle did not materially change churn: production continued to emit roughly
  280 to 310 empty mailbox imports and idle checkpoints per minute.
- Nineteen due workspaces had no mailbox rows beyond their imported system
  frontier. Seventeen retained a gap between imported and handled-through state,
  totaling 1,234 unconsumed model-free system items.
- Current Web reconciliation logs prove those invocations are blocked by the
  engagement policy while preserving a due assistant wake and two lagging
  mailbox lanes.
- The private Temporal worker correctly selects `system_mailbox` while Web is
  blocked. Cloudflare currently forwards only the processing mode because its
  separate workspace projection exposes no engagement-policy decision.
- The runtime therefore sees the due assistant cron as runnable, checkpoints
  the system-to-assistant handoff before processing a retained system item, and
  wakes Temporal again. The empty checkpoint advances workspace version but not
  the system handled-through frontier, reproducing the one-to-three-second loop.
- An existing runtime regression proves the intended behavior when
  `assistantExecutionBlocked: true` reaches the same invocation: eligible
  system work drains, assistant execution remains skipped, and the assistant
  reminder stays durable for policy restoration.
- The retained system frontier is itself heterogeneous. At the current
  imported-but-unhandled boundary, aggregate production proof found twelve
  workspaces headed by operator-maintenance controls, three by browser-vault
  refresh controls, and six by device-sync work. System mode advertised all of
  those items as runnable but executed only device-sync, so the first fix alone
  could not converge the dominant frontiers.

All evidence is aggregate and contains no production identifiers.

## Product UX Patch

- Runnable scheduled work must continue to execute promptly.
- A stale, blocked, or otherwise non-runnable wake must converge instead of
  repeatedly consuming hosted capacity.
- Foreground mailbox and system-mailbox work must keep their current priority
  and recovery behavior.

## Constraints

- Web remains the canonical owner of persisted workspace wake facts.
- Temporal remains pointer-only orchestration and must not gain domain state.
- Do not add a queue, scheduler, state owner, or compatibility layer.
- Do not clear a wake merely to hide churn when real work remains runnable.
- Preserve database-load and product-critical-flow invariants.

## Plan

1. Add an optional positive-only `assistantExecutionBlocked` field to the shared
   ensure-processing contract, valid only for explicit `system_mailbox` work.
2. Forward the field through Cloudflare to the existing runtime invocation
   guard, without adding persisted state, another policy read, or a new owner.
3. Align system-mode wake projection and execution on the same exact bounded
   model-free set: device sync, operator maintenance, and browser-vault refresh.
   Leave every other system item with its default owner.
4. Publish the additive public contract and deploy the tolerant Cloudflare
   consumer before updating the private Temporal producer.
5. Have Temporal derive the field from the current authoritative blocked fact
   only when it dispatches model-free system work. Preserve default/conversation
   processing, canonical wakes, mailbox pointers, and Temporal command order.
6. Run focused contract, Cloudflare, runtime, Temporal, replay, typecheck, and
   production-bundle proof. Push exact candidates and run preliminary and final
   ReviewGPT gates alongside required CI.
7. Merge and deploy in compatibility order, then verify multiple complete
   production windows until churn collapses and the retained system gap drains
   without lost assistant wakes or shifted errors.

## Verification

- Root cause: proven from current production aggregates, authoritative Web
  reconciliation logs, exact deployed code, and the existing runtime guard
  regression.
- Independent ReviewGPT root-cause audit: running.
- Public contract/Cloudflare tests, private Temporal/replay tests, typechecks,
  bundle proof, exact-head ReviewGPT gates, CI, deploy, and production
  convergence: pending.
