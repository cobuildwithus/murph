# Device sync durable handoff

Status: completed
Created: 2026-06-05
Updated: 2026-06-05

## Goal

- Move hosted device-sync freshness from transient recovery flags to bounded,
  durable mailbox handoff while keeping dirty Postgres rows as the work queue.

## Success criteria

- Successful hosted provider callbacks mark setup as source-confirmed without
  waiting for first sync success.
- Webhook dirty acceptance appends exactly one `device-sync.wake` on a
  clean-to-dirty transition and does not append per-webhook system rows while
  already dirty.
- Scheduled reconcile uses the normal mailbox handoff path, not
  `device_sync_recovery_requested`.
- Shared contracts, web demand, and Temporal workflow state no longer carry
  `deviceSyncRecoveryRequested` or `device_sync_recovery` as live semantics.
- Docs describe durable dirty rows plus bounded mailbox handoff as the current
  path.
- Focused tests and required verification/audits pass or have a documented
  unrelated blocker.

## Scope

- In scope:
  - Hosted web device-sync callback, dirty-state, wake, and scheduled reconcile
    handoff code.
  - Shared public-ingress setup completion behavior.
  - Regression tests for wake coalescing and scheduled reconcile handoff.
  - Deletion of live Temporal recovery state/source machinery while keeping
    legacy signal parsing inert for deploy-history compatibility.
  - Durable architecture docs that currently describe recovery nudges as the
    correctness path.
- Out of scope:
  - Adding a new mailbox lane.
  - Adding a device-sync-specific sweeper or queue.
  - Changing Cloudflare runner topology.

## Constraints

- Preserve foreground conversation priority over system/device-sync work.
- Keep Temporal state pointer-only and avoid raw provider payloads, tokens,
  prompts, transcripts, or dirty resource bodies in workflow history.
- Do not store per-webhook mailbox rows for dirty freshness.
- Keep event ids deterministic, minimal, and free of trace IDs or provider
  payload identifiers.

## Risks and mitigations

1. Risk: system-lane mailbox rows flood foreground runtime import.
   Mitigation: append only on clean-to-dirty transitions and test repeated
   dirty hints with different trace IDs.
2. Risk: a consumed/yielded wake strands dirty work.
   Mitigation: preserve dirty rows as the work source and keep scheduled
   reconcile handoff durable.
3. Risk: deploy skew with existing recovery signals.
   Mitigation: leave legacy recovery signal parsing in the workflow, but make it
   inert so it cannot set a demand flag or source.

## Tasks

1. Apply the supplied Milestone 1 patch in the isolated worktree.
2. Tighten event-id and helper shape for a minimal durable handoff.
3. Update durable docs to match the new handoff contract.
4. Run focused tests, typecheck/acceptance as feasible, and required audit
   passes.
5. Commit with `scripts/finish-task`, push the branch, and open a PR.

## Decisions

- Keep `device-sync.wake` on the existing `system` mailbox lane for this
  milestone. A third lane is deferred until bounded system-lane handoff proves
  insufficient.
- Treat mailbox wake rows as handoff only. Dirty rows and dirty payload rows
  remain the durable work queue.

## Verification

- Commands to run:
  - `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/device-sync/wake-service.ts apps/web/src/lib/device-sync/control-plane.ts apps/web/test/device-sync-hosted-wake.test.ts packages/device-syncd/src/public-ingress.ts docs/device-sync-hosted-control-plane.md agent-docs/references/hosted-runtime-protocol.md agent-docs/references/hosted-temporal-orchestration.md apps/web/README.md packages/hosted-orchestrator-temporal/README.md`
  - `pnpm typecheck`
  - Additional package/app checks or direct scenario proof if audit findings
    reveal a gap.
Completed: 2026-06-05
