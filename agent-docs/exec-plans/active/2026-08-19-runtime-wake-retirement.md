# Retire Persistent Hosted Runtime Wakes

Status: active
Updated: 2026-08-19

## Goal

Eliminate repeated successful no-op hosted-runtime invocations while preserving
real scheduled work, foreground mailbox priority, and the existing ownership
boundaries between Web, Temporal, and the Cloudflare runtime.

## Production Evidence

- The previously deployed cross-mode controller correction did not materially
  change churn.
- A current five-minute sample contained 1,635 attempts, 1,625 empty mailbox
  imports, 1,635 retained-wake idle checkpoints, and no errors.
- The canonical workspace table still contained a small due cohort: 17
  assistant wakes and 2 device-sync wakes.
- Assistant-pass completion events were nearly absent relative to the repeated
  runtime attempts, so the investigation is focused on the path that retains a
  due assistant wake without executing assistant work.
- A fifteen-minute export contained 10,075 typed or server-redacted runtime
  events. Of 4,764 two-event attempts, 4,747 imported no mailbox work and 4,752
  checkpointed a retained assistant wake; the repeated snapshots were otherwise
  structurally unchanged.
- Production still runs the commit immediately before the already-merged later
  reminder handoff. Its production-shaped seven-interleaving regression passes
  on current main, including the no-signal predecessor/successor case matching
  the live trace.
- The first deploy attempt containing that handoff resolved current main but
  stopped before Cloudflare because later merged bounded foreground-state work
  intentionally grew the existing vault CLI graph by 29,972 bytes without
  rebaselining its narrow deployment ratchet. Local production assembly then
  exposed the same reviewed graph's 35,529-byte static runner-entrypoint excess;
  both existing ratchets require measured baseline updates, with entry and
  platform tolerances unchanged.

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

1. Trace the exact no-progress wake path and obtain an independent ReviewGPT
   diagnosis from the same code and aggregate evidence.
2. Confirm the already-merged production-shaped predecessor/successor
   regression covers the live no-signal churn before adding another wake owner.
3. Rebaseline only the measured runner-bundle total-byte ratchet required to
   deploy current main; preserve its entry and static-closure limits.
4. Run the real bundle assembly, focused policy test, typecheck, and hosted
   reminder proof.
5. Push the exact unblocker candidate, run preliminary and final ReviewGPT gates
   alongside required CI, and resolve every accepted finding.
6. Merge, deploy the exact reviewed head with immediate container rollout, and
   verify sustained convergence in at least two complete production windows
   before retiring the worktree.

## Verification

- Seven predecessor/successor wake interleavings: passed.
- Independent ReviewGPT root-cause audit: current main's existing held-successor
  correction matches the live loop; no new runtime owner or Cloudflare wake
  suppression is warranted. It requested one empty checkpoint-runtime-recheck
  coverage case, now included in the existing parameterized regression.
- Local production bundle assembly: passed at 9,265,283 vault CLI bytes and an
  8,397,990-byte static runner-entrypoint closure with the measured ratchets.
- Cloudflare typecheck and 55 focused bundle-policy tests: passed.
- Empty checkpoint-runtime-recheck wake regression: 8 parameterized cases
  passed.
- Exact-head ReviewGPT gates, CI, deploy, and production convergence: pending.
