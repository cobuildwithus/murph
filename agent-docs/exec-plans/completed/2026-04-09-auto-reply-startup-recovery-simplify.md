# Auto-Reply Startup Recovery Simplify Plan

## Goal

Simplify the newly landed startup auto-reply recovery path without changing its behavior or retry-safety guarantees.

## Scope

- Reduce unnecessary structure in startup recovery candidate selection.
- Trim helper surface area where current callers do not need the extra inputs.
- Keep the startup-only recovery semantics and existing safety checks intact.

## Constraints

- Do not change the main `autoReplyScanCursor` semantics.
- Do not add durable retry state.
- Preserve the startup-only, bounded, retry-safe recovery behavior.
- Preserve unrelated dirty worktree edits.

## Verification

- `pnpm --filter @murphai/assistant-engine test -- assistant-automation-runtime.test.ts`
- `pnpm --filter @murphai/assistant-engine test:coverage`
- `pnpm --filter @murphai/assistant-engine typecheck`

## Outcome

- Collapsed startup recovery candidate selection into a single newest-first receipt pass using a seen-capture set.
- Removed unused provider watchdog timing fields from the startup-recovery helper input surface.
- Preserved the existing startup-only, cursor-bounded, retry-safe recovery behavior while shrinking the helper implementation.

Status: completed
Updated: 2026-04-09
Completed: 2026-04-09
Completed: 2026-04-09
