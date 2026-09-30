# Keep runner lifecycle alarms independent of active invocations

Status: completed
Created: 2026-09-29
Updated: 2026-09-29

## Goal

- Keep the native runner's maintenance alarm cycling during a long invocation,
  removing an application-owned stall before controller reactivation. Preserve
  actual runtime typing and remove the earlier ingress typing workaround.

## Success criteria

- A real invocation held at its container response cannot hold activity expiry.
- Repeated expiry schedules one future check without stopping active work.
- Idle cleanup retains its lock and rechecks interaction ownership after I/O.
- Focused tests, typecheck, complexity review, exact-head CI and review pass.

## Scope

- In scope: lifecycle ordering, regression proof, slow successful wake diagnostics.
- Out of scope: new wake transports, polling, provider acknowledgement changes.

## Constraints

- Reuse the SDK scheduler and existing lifecycle/ownership fences. Add no state
  owner or retry loop. Keep production records out of durable artifacts.

## Risks and mitigations

1. Scheduling maintenance outside the lifecycle lock must not permit destruction
   during new work. Keep all destructive evaluation locked and preserve the
   interaction-generation check after external reads.
2. Platform resets and dispatch latency are not fully controlled by application
   code. Local proof demonstrates removal of the alarm lock dependency, not an
   absolute production latency guarantee or proof of the platform reset trigger.

## Tasks

1. [x] Reproduce the alarm blocked behind a real invocation.
2. [x] Reorder the existing lifecycle evaluator and remove symptom-only changes.
3. [x] Verify active, idle, race, and reactivation paths; update owner docs and PR.
4. [x] Complete local review and scoped implementation. Exact-head CI and external
   review remain PR gates; merge and production verification remain separate.

## Decisions

- The previous completed typing-admission plan is historical and superseded by
  this scope. Keep its record immutable; remove its product behavior from this PR.

## Verification

- Regression failed before the source edit: activity expiry remained unresolved
  while the real invocation held the lifecycle lock. It passes after reordering,
  across three synthetic maintenance cycles with the invocation still active.
- Cloudflare: 286 runner-container and processing-summary tests passed, including
  idle cleanup, ownership races, and reactivation. Cloudflare typecheck passed.
- Web: 71 Telegram and changelog tests passed after restoring baseline behavior;
  Web typecheck passed. Removed the now-empty task-created changelog directory.
- `pnpm complexity:diff` passed for the two changed source files; existing
  unrelated hotspots did not increase. Whitespace and privacy review passed.
- Product UX: Ready for code review. Active work remains protected, idle cleanup
  remains fenced, and actual runtime typing keeps its baseline path. No new
  member-facing timing guarantee. No production deploy or platform failover
  experiment was performed.
Completed: 2026-09-29
