# Codex Resume Failure Diagnostics

## Goal

Add broader, verbose production diagnostics for resumed Codex assistant failures so generic `turn_failed` resume failures with zero provider actions are observable without another deploy.

## Constraints

- Preserve privacy guardrails: no raw prompts, user messages, health data, credentials, direct identifiers, or home paths in logs.
- Prefer redacted and bounded diagnostic strings only when they pass the hosted runtime safe-text filter.
- Preserve unrelated working-tree edits, especially active hosted runtime/provider fixture changes.

## Plan

1. Emit a generic resumed-Codex-failure trace for any resumed Codex failure, not only `input.N.output: Invalid input`.
2. Keep the existing invalid-output fallback trace behavior, but share the same diagnostic detail shape where possible.
3. Teach hosted runtime log parsing and allowlists to persist the new diagnostic fields.
4. Add focused engine/runtime tests for generic resume failure diagnostics and safe text persistence.
5. Run scoped verification and required audit passes, then commit if the dirty worktree permits a scoped commit.

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run test/provider-registry-helpers.test.ts` passed.
- `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-events.test.ts test/hosted-runtime-workspace-assistant-phase-diagnostics.test.ts` passed.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `pnpm --dir packages/assistant-engine test` passed.
- `pnpm logs:guard` passed.
- `pnpm --dir packages/assistant-runtime test` failed on pre-existing unrelated assertions in hosted Codex config, device-sync config shape, and Vercel Gateway Stripe customer context tests.
Status: completed
Updated: 2026-05-05
Completed: 2026-05-05
