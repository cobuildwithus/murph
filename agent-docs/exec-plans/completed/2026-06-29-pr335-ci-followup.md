# PR 335 CI Follow-Up

## Goal

Make PR 335 CI green without adding new runtime architecture: fix the hosted scheduled-reminder stale wake after post-checkpoint delivery, and handle the independent release app verification failure with the smallest truthful test/code correction.

## Constraints

- Keep deferred hosted usage recording off the foreground reply path.
- Do not add queues, schedulers, new state owners, or compatibility layers.
- Preserve mailbox/checkpoint ownership and post-checkpoint side-effect invariants.
- Preserve unrelated main-checkout/user work.

## Current Evidence

- `Linq scheduled reminder E2E` delivered the outbound message and cleared pending delivery effects, but wrote `nextWakeAt`/`hostedAssistantNextWakeAt` in the past relative to `checkpointedAt`.
- `Release app verification (ubuntu)` fails in `apps/web/test/computer-handoff-active-view.test.tsx` because the release merge shard sees the current component focus-button label while the test still queries the older label.

## Plan

1. Reproduce and patch stale post-delivery wake handling in assistant-runtime.
2. Add focused regression coverage for the stale-wake case.
3. Reconcile the hosted-web handoff test with the current component label using the smallest durable change.
4. Run focused package/app checks, then push and recheck PR CI.
Status: completed
Updated: 2026-06-29
Completed: 2026-06-29
