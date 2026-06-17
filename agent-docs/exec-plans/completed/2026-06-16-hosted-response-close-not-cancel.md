# Hosted response close is not cancellation

## Goal

Stop pure response delivery loss after an accepted hosted workspace job from
aborting the in-container invocation and poisoning the warm container.

Success criteria:

- After `/internal/workspace-invocation` accepts a workspace job, a closed
  response by itself does not abort the workspace invocation.
- Explicit preemption can still cancel the accepted invocation.
- Cleanup failure and other genuinely unsafe warm-runtime states still poison
  or stop the container.
- Focused tests prove the transport/cancellation split.

## Constraints

- Keep the change deletion-first and narrow: no result store, no new queue, no
  restore handshake, no scheduler.
- Preserve `RunnerContainer.abortWorkspaceInvocation` semantics with a concrete
  invocation identity.
- Edit `apps/cloudflare/src/runner-container.ts` only where needed to keep the
  durable recovery/liveness path coherent after response transport loss.
- Preserve unrelated worktree edits.

## Approach

1. Split response-close observation from accepted-job invocation cancellation.
2. Route semantic cancellation through a small internal abort endpoint keyed by
   attempt, fence generation, and user.
3. Delete ambiguous-abort poisoning so response close alone is not poison
   authority after a job has been accepted.
4. Add focused entrypoint regression tests.
5. Run app-local Cloudflare verification plus required audits.

## State

Active.

## Notes

- Production incident diagnosis: Cloudflare logged network connection loss,
  then the entrypoint emitted `ambiguous_abort_poison` with no direct invocation
  result and exited 1.
- ReviewGPT direction: first safe change is narrower than ignoring all
  transport aborts; treat pure response close after acceptance as response
  delivery failure, while preserving explicit semantic cancellation.
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
