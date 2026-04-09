# Assistant Access Surface Cleanup

## Goal

Refine the recent assistant access-mode seam so provider definitions expose only their inherent Murph command surface, while route/prompt logic derives the effective access mode for the current turn. Trim prompt duplication in the automation guidance without changing execution behavior.

## Scope

- `packages/assistant-engine/**`
- Focused tests around provider capabilities, prompt generation, and provider-turn planning

## Constraints

- Keep execution behavior unchanged.
- Keep the cleanup narrower than a larger execution-family refactor.
- Preserve unrelated in-flight edits.

## Plan

1. Split provider-level command surface from route-level effective access mode.
2. Update the assistant prompt seam to consume the route-level mode.
3. Deduplicate the repeated automation prompt copy with small shared helpers only.
4. Re-run focused assistant-engine verification.

## Verification

- Focused assistant-engine Vitest tests for prompt/runtime/provider seams
- `pnpm typecheck` if feasible, noting unrelated blockers separately if still red
Status: completed
Updated: 2026-04-09
Completed: 2026-04-09
