# Linq Egress Route Matrix

## Goal

Prove the Cloudflare runner Linq egress allowlist covers every currently used
hosted runtime Linq API route without widening provider egress.

## Scope

- `apps/cloudflare/test/runner-egress-intercept.test.ts`

## Constraints

- Keep Linq egress fail-closed behind sentinel authorization and runtime write
  fence checks.
- Do not expose provider payloads, user/contact identifiers, secrets, or raw
  authorization values.
- Preserve unrelated active ledger rows and worktree edits.

## Plan

1. Add a matrix test for the current hosted runtime Linq API route set.
2. Run focused intercept tests and scoped verification.
3. Close with a scoped commit.

## Verification

- `pnpm exec vitest run apps/cloudflare/test/runner-egress-intercept.test.ts --config apps/cloudflare/vitest.node.workspace.ts --no-coverage -t "Linq"` passed.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/test/runner-egress-intercept.test.ts` passed.
- `git diff --check` passed for the scoped Cloudflare test, plan, and ledger files.
- `pnpm typecheck` is blocked by unrelated dirty assistant-engine changes in
  `packages/assistant-engine/test/assistant-protocol-index-planning.test.ts`.

## State

- Static comparison and route-matrix test found the runtime route set is
  covered: phone number probe, chat create, chat message send, typing
  start/stop, read receipt, message cleanup, and attachment metadata.
Status: completed
Updated: 2026-05-22
Completed: 2026-05-22
