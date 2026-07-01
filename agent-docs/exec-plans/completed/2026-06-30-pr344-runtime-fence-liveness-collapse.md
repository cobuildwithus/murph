# PR 344 Runtime Fence Liveness Collapse

## Goal

Collapse duplicated runtime-fence liveness interpretation so stale-fence recovery uses one shared primitive while preserving foreground priority and fail-closed authority behavior.

## Constraints

- No new scheduler, queue, persisted state, route, or ownership layer.
- Preserve direct Cloudflare Durable Object RPC calls on container stubs.
- Preserve foreground/default work priority over `inbox_media_retention`.
- Mismatched runtime identity must not be treated as committed progress for the requested fence.

## Approach

- Add one internal runtime-fence liveness reader/classifier for exact-active, inactive, mismatched, and indeterminate outcomes.
- Use it from both UserRunner controller recovery and runtime invocation transport-failure recovery.
- Keep policy decisions in the callers: controller decides retry/replace/preempt; invocation decides preserve/recover/clear.

## Verification

- Focused Cloudflare runtime invocation transport-failure tests.
- Focused UserRunner alarm/state-machine tests.
- Cloudflare typecheck.
Status: completed
Updated: 2026-06-30
Completed: 2026-06-30
