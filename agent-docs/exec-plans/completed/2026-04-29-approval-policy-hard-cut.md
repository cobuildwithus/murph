# Approval Policy Hard Cut

## Goal

Hard-cut assistant approval policy handling so the assistant runtime accepts only noninteractive Codex App Server turns with `approvalPolicy` unset or `never`.

Success criteria:

- Runtime schemas no longer advertise `untrusted` or `on-request` as valid assistant approval policies.
- Codex provider launch uses the shared Codex App Server approval-policy resolver instead of a duplicated local assertion.
- Codex App Server request shaping has one approval-policy source of truth and no unreachable mappings for unsupported interactive policies.
- Focused tests cover schema rejection and provider/app-server fail-closed behavior.

## Constraints

- Preserve unrelated dirty work in the checkout.
- Do not widen into active-turn, hosted runtime, or Cloudflare runner rows.
- No dependency changes.
- No personal identifiers in generated files, comments, examples, logs, or commits.

## Files

- `packages/operator-config/src/assistant-cli-contracts.ts`
- `packages/operator-config/test/codex-hard-cut-contract.test.ts`
- `packages/assistant-engine/src/assistant/providers/codex-cli.ts`
- `packages/assistant-engine/src/assistant-codex/app-server-requests.ts`
- `packages/assistant-engine/test/assistant-codex-runtime.test.ts`
- `packages/assistant-engine/test/assistant-session-resolution.test.ts`

## Verification

- Passed: `pnpm --dir packages/operator-config exec vitest run --config vitest.config.ts --no-coverage test/codex-hard-cut-contract.test.ts`.
- Passed before overlapping provider-registry changes moved underneath the worktree: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-runtime.test.ts test/assistant-session-resolution.test.ts`.
- Current focused rerun: `assistant-codex-runtime.test.ts` behavior remains green, but `assistant-session-resolution.test.ts` is blocked by the unrelated active provider-abstraction row failing to register `codex-cli`.
- Passed: `pnpm --dir packages/operator-config typecheck`.
- Blocked: `pnpm --dir packages/assistant-engine typecheck`, scoped `bash scripts/workspace-verify.sh test:diff ...`, and root `pnpm typecheck` currently stop in unrelated active provider-abstraction edits.

## Progress

- Narrowed the assistant approval-policy value set to `never`.
- Removed the provider-local Codex approval-policy assertion.
- Routed Codex provider and app-server request shaping through `resolveSupportedCodexAppServerApprovalPolicy`.
- Added focused hard-cut coverage for schema rejection and stale untyped runtime input rejection.
