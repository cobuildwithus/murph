# Stop blocking admission on a finished job's completion callback

Status: active
Created: 2026-10-18
Updated: 2026-10-18

## Goal

- A finished job's recovery completion callback no longer blocks admission of the
  member's next job on the same warm runner. The callback stays awaited for
  process lifetime and keeps recovering a lost outer result.

## Success criteria

- Health `activeJobCount` keeps exact total lifetime semantics. Shutdown drain,
  post-shutdown wake absence, idle cleanup, the legacy wake probe and standby
  pristine checks are unchanged.
- Admission excludes only settling callbacks. Real running work, abort/restore
  settlement and smoke routes stay busy.
- A Worker readiness check uses total minus settling only for a valid child
  report; absent falls back to the total; malformed stays busy.
- A composed real controller plus real entrypoint test shows the next job
  starting on the same warm child while the callback is pending, with no
  destroy. The older-child variant keeps today's busy result.
- No added network call, readiness kind, cache, Web or Postgres state, or
  typing order/origin change.

## Product UX (Patch)

- Outcome: a member who messages right after Murph finishes a reply no longer
  waits for the previous reply's completion bookkeeping before the next job can
  start on the same warm runner.
- Reaches: back-to-back messages on a warm runner; messages during running work,
  recovery of a lost result, and mixed-version rollout keep today's behavior.
- Proof: composed real controller plus real entrypoint handoff; running-work
  409; lost-outer-response and stale-callback guards; old-child fallback.

## Scope

- In scope: container entrypoint admission gates, the settling counter and
  health field; the Durable Object readiness busy predicate; focused tests;
  hosted runtime reference docs.
- Out of scope: the completion callback itself, idle cleanup (open PR #3994
  owns `canStopWarmContainer`), the starting fence, the wake probe and the cold
  start path.

## Constraints

- Canonical claim, exact generation, native receipts and user authorization are
  unchanged. A new attempt still requires canonical release.
- Old Worker with new child keeps the conservative total; new Worker with old
  child falls back to the total.

## Risks and mitigations

1. Risk: a stale callback touches a successor.
   Mitigation: the existing Web reconcile, native receipt identity and Postgres
   CAS guards reject it; this change grants no authority.
2. Risk: counter imbalance.
   Mitigation: increment and decrement in one `try/finally`; mutation-tested.

## Verification

- Cloudflare typecheck; focused Vitest for the entrypoint, entrypoint abort,
  composed handoff, runner-container readiness, completion and controller
  suites; mutation checks of both sides; `pnpm complexity:diff`;
  `runner:bundle`; docs drift.
