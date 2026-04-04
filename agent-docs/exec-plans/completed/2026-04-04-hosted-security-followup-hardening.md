# Hosted Security Follow-Up Hardening

## Goal

Land the supplied hosted security follow-up patch against the current repo snapshot without overwriting unrelated worktree edits.

## Scope

- Apply the hosted hardening changes across `apps/cloudflare`, `apps/web`, `packages/hosted-execution`, and `packages/assistant-runtime`.
- Preserve any unrelated in-flight edits already present in the repo and resolve patch drift by porting behavior, not by forcing snapshot-era file contents.
- Update durable docs only where the patch changes current hosted runtime or security expectations.

## Constraints

- Treat this as a high-risk trust-boundary/runtime landing and keep the behavior aligned with current hosted architecture.
- Do not revert unrelated work already present in the tree.
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
