# PR 319 Eragon Round 2 Fixes

## Goal

Address accepted Eragon ReviewGPT round 2 findings for PR 319 after merging `origin/main`.

## Scope

- Keep AI usage notice text stable for a shared Linq idempotency key.
- Wire signup welcome variants into the hosted activation path if runtime compatibility remains safe on the merged base.
- Collapse user-facing message renderer ownership out of public contracts if only `apps/web` consumes it.

## Constraints

- Preserve provider idempotency invariants.
- Keep product-copy ownership local unless a real cross-package contract needs it.
- Do not add rollout flags or broad compatibility machinery.

## Verification

- Focused contracts/web/assistant-runtime tests as affected.
- `pnpm test:diff` for touched files.
- `pnpm typecheck`.

Status: completed
Updated: 2026-06-26
Completed: 2026-06-26
