# Hosted runner live lifecycle stabilization

## Goal

Finish the hard-cut production proof by preventing fallback container lifecycle
cleanup from preempting active hosted runner work, while preserving the clean
Cloudflare-as-thin-runner architecture.

Success means:

- Activity-expiry fallback cleanup is idle-only and yields while a workspace
  invocation or browser-vault refresh is actively using the warm shell.
- A stale active-operation marker can still age out and allow fallback cleanup
  after the runner timeout window.
- Hosted runner failure logs include safe metadata needed to distinguish
  invalid request classes without exposing payloads, secrets, identifiers, or
  message content.
- Focused Cloudflare tests cover the live regression, and the fix is deployed
  and checked against redacted iMessage/Linq probes.

## Scope

- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/src/user-runner.ts`
- Focused Cloudflare tests around runner container lifecycle and runner
  invocation failure diagnostics.

## Constraints

- Preserve the hard-cut invariants from completed `HARD_CUT.md`: foreground
  reply work must not snapshot, only idle shutdown checkpoints write hosted
  workspace snapshots, and browser-vault work stays off the critical reply path.
- Keep Cloudflare as coordination only; do not add a second runtime state
  machine.
- Diagnostics must remain metadata-only and privacy-safe.

## Plan

1. Add per-operation container-local active markers with expiries bounded by
   the runner timeout.
2. Make activity-expiry fallback cleanup skip while any marker is active, and
   continue to clean up when no active marker exists or only stale markers
   remain.
3. Add safe runner failure diagnostics for workspace invocation failures.
4. Update focused tests for cross-isolate activity expiry during active work and
   diagnostics.
5. Run required verification, audit, commit, push, Pro review, deploy, and live
   iMessage/Linq proof.
Status: completed
Updated: 2026-05-10
Completed: 2026-05-10
Completed: 2026-05-10
