# PR 344 Runtime Fence Simplification

## Goal

Fix the remaining PR 344 ReviewGPT findings without adding a new scheduler,
queue, or preemption service:

- foreground/default runtime work must not wait behind active
  `inbox_media_retention` work
- inactive-fence replacement should have one controller owner instead of a
  separate committed-progress completion branch

## Constraints

- Preserve hosted foreground priority.
- Keep Cloudflare as the execution adapter, not mailbox/workspace truth owner.
- Use existing wake and write-fence primitives where possible.
- Do not add persisted state.

## Plan

1. Use the existing runtime liveness and abort primitive to preempt active
   retention work for foreground/default requests only.
2. Collapse inactive-fence replacement by clearing/replacing inactive fences
   directly instead of asking web status whether they completed first.
3. Update focused controller tests and hosted runtime protocol docs.
4. Run focused Cloudflare tests and typecheck.
Status: completed
Updated: 2026-06-30
Completed: 2026-06-30
