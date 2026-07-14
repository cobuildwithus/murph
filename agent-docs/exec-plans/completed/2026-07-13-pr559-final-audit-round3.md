# PR 559 final audit round 3

## Goal

Resolve the validated final-head ReviewGPT finding that retained generic
webhook payloads could trigger immediate hosted replays instead of honoring the
local job scheduler's backoff, without deleting the only cold-restore copy.

## Success criteria

- Exact generic payloads remain hosted while their machine-local job is queued,
  so cold restore can reconstruct lost queue work.
- A retryable generic job remains queued at its durable `available_at`, and the
  post-checkpoint handoff publishes that future wake instead of the web row's
  immediate still-dirty wake.
- Generic execution success or terminal failure acknowledges the hosted
  payload, so dead jobs are not recreated. A job marked succeeded only because
  of a machine-local disconnect remains hosted until an authoritative snapshot
  selects active replay or terminal disposition.
- Verified Junction companion RMSSD payloads acknowledge only after canonical
  import succeeds.
- Existing companion yield, retry, cold-restore, terminal-account, canonical
  success, and timezone-replay protections remain intact.
- Focused tests/typecheck, diff-aware verification, required local completion
  audits, one substantive clean corrected-head ReviewGPT audit, GitHub CI, and
  final head/review/mergeability gates pass.

## Working set

- `packages/assistant-runtime/src/hosted-device-sync-runtime.ts`.
- `packages/assistant-runtime/src/hosted-runtime/device-sync-maintenance.ts` and
  `packages/assistant-runtime/src/hosted-runtime/system-mailbox.ts`.
- `packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts`.
- `apps/web/test/device-sync-hosted-runtime-authority.test.ts`.
- `docs/device-sync-hosted-control-plane.md` and
  `agent-docs/operations/device-sync-ingestion-invariants.md`.

## Persisted-state classification

No new persisted state, retry owner, queue, or schema is introduced. Web's
encrypted payload row remains the reconstruction authority because the
machine-local device-sync database is intentionally excluded from hosted
snapshots; the existing local scheduler remains the timing owner.

## Verification plan

- Reproduce the pre-fix retry loop by returning an immediate still-dirty wake
  while a retryable local job has a future `available_at`.
- Prove the checkpoint result retains the generic payload but selects the local
  future wake, then prove a fresh workspace reconstructs and completes that
  exact payload after the machine-local queue is absent.
- Prove terminal generic failure is acknowledged once and is not reconstructed
  in the fresh workspace.
- Preserve the disconnect-state guard so skipped generic execution cannot be
  mistaken for import success, and prove the next authoritative active or
  terminal snapshot owns the disposition.
- Preserve focused companion retention tests and run the assistant-runtime
  owner suite/typecheck, diff-aware verification, docs drift, privacy/diff
  checks, and serialized required completion audits.
- Close this plan in a scoped commit, push one stable correction head, run one
  substantive clean ReviewGPT audit on that exact head, and wait for green CI.

## External proof limitation

The real 60-second capture-to-query proof still requires the owned physical
iPhone/WHOOP surface and authenticated session. It must not be simulated.

## State

Active.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
