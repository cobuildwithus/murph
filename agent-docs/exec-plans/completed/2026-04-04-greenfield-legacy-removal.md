# Greenfield Legacy Removal

## Goal

Land the supplied legacy-removal patch against the current repo snapshot without regressing the hosted security follow-up hardening that was already committed.

## Scope

- Remove legacy hosted token fallbacks, assistant doctor legacy-secret migration logic, and legacy Vitest env aliases where the current repo still carries them.
- Preserve the newer hosted hardening behavior already landed in `apps/cloudflare`, `apps/web`, and `packages/hosted-execution`.
- Update durable docs only where the legacy-removal patch changes current runtime, security, or verification guidance.

## Constraints

- Treat this as a concurrent supplied-patch merge, not a clean snapshot apply.
- Resolve overlapping hunks by porting the intended legacy removal onto current file contents.
- Finish with required verification, one final review audit pass, and a scoped commit.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Status

- In progress
Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
