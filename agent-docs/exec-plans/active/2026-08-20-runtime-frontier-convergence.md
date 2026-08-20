# Hosted Runtime Frontier Convergence

Status: active
Updated: 2026-08-20

## Goal

Make three proven hosted-runtime failure boundaries converge without weakening
foreground priority, mailbox ordering, replay safety, or Web-owned durable
truth:

1. a deterministic system notification must not permanently block eligible
   model-free system work behind it when assistant automation is policy-blocked;
2. a device-sync pass that starts must leave durable completion or exact
   interruption/retry evidence before ownership is released; and
3. a foreground-progress checkpoint with still-due device work must receive a
   bounded orchestration re-dispatch.

## Constraints

- Preserve FIFO completion and handled-through fences; do not delete, skip, or
  manually consume durable mailbox rows.
- Preserve foreground conversation and accepted assistant work ahead of device
  maintenance.
- Keep Web as the product/control truth owner, Temporal pointer-only, and
  Cloudflare as the execution adapter.
- Add no scheduler, queue, polling owner, broad resync, or persisted duplicate
  domain state.
- Keep production evidence aggregate and anonymous in repository artifacts.
- Maintain replay-safe Temporal deployment and migration requirements.

## Plan

1. Give ReviewGPT the aggregate production evidence, exact current source, the
   relevant merged and pending changes in both repositories, and require a
   scoped implementation patch with focused regressions.
2. Inspect the returned implementation against mailbox ownership, foreground
   priority, device-pass durability, Temporal replay, and deployment ordering.
3. Apply only evidence-backed changes; reject speculative fallbacks or manual
   data repair.
4. Run focused public and private runtime, mailbox, Cloudflare, Temporal, replay,
   and typecheck proof selected from the touched paths.
5. Commit and open the required PR or coordinated PRs, then run preliminary and
   final exact-head ReviewGPT gates with required CI.
6. Deploy in compatibility order and verify the corrected production frontiers
   converge before resolving the incident.

## Verification

- Pending ReviewGPT implementation result.
- Pending focused local proof.
- Pending exact-head CI and ReviewGPT gates.
- Pending safe deployment and production convergence proof.
