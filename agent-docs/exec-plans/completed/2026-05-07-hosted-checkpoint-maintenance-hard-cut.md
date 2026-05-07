# Hosted checkpoint maintenance hard cut

## Goal

Remove the legacy hosted workspace checkpoint reason `maintenance` from the current shared protocol after confirming idle-shutdown full checkpoints cover the old off-path full/base compaction role.

## Success criteria

- `maintenance` is no longer accepted by the hosted checkpoint contract/parser.
- Cloudflare snapshot policy no longer maps `maintenance` to a full snapshot.
- Current tests use explicit checkpoint reasons instead of `maintenance`.
- Live docs do not describe `maintenance` as a current checkpoint reason.
- Focused contract/web/Cloudflare verification passes or any unrelated blocker is recorded.

## Scope

- `packages/hosted-execution/src/runtime-control.ts`
- `packages/hosted-execution/test/hosted-runtime-control.test.ts`
- `apps/cloudflare/src/runtime-bridge-workspace.ts`
- `apps/cloudflare/test/runtime-bridge-workspace.test.ts`
- `apps/cloudflare/test/runner-platform.test.ts`
- `apps/web/test/hosted-runtime-internal-routes.test.ts`
- `apps/web/test/hosted-workspace-store.test.ts`
- Live hosted runtime docs if static search finds current `maintenance` checkpoint references

## Constraints

- Hard cut is explicitly requested; no compatibility window for old `maintenance` checkpoint senders.
- Do not rely on idle shutdown as an active correctness fence for import, active-turn, outbox, activation, or canonical runtime commits.
- Preserve unrelated dirty worktree edits and active ledger rows.
- Avoid exposing secrets, raw paths, user identifiers, or runtime payloads in logs/docs.

## Plan

1. Register this active plan in the coordination ledger.
2. Remove `maintenance` from the shared checkpoint reason list.
3. Remove Cloudflare `maintenance` snapshot-policy handling.
4. Update focused tests and any live docs that refer to the current reason.
5. Run focused verification for hosted-execution, Cloudflare snapshot policy, and web checkpoint store/route tests.
6. Review diff for privacy/path leakage and summarize commit blockers if unrelated dirty work prevents scoped finish.

## Verification

- PASS: `rg -n '"maintenance"' packages apps -g '!**/node_modules/**' -g '!**/dist/**' -g '!**/.next/**'` now finds only rejection-test literals in `packages/hosted-execution/test/hosted-runtime-control.test.ts` and `apps/web/test/hosted-workspace-store.test.ts`.
- PASS: `pnpm --dir packages/hosted-execution exec vitest run test/hosted-runtime-control.test.ts`
- PASS: `pnpm --dir packages/hosted-execution typecheck`
- PASS: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage runtime-bridge-workspace.test.ts runner-platform.test.ts`
- PASS: `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-workspace-store.test.ts apps/web/test/hosted-runtime-internal-routes.test.ts`
- PASS: `git diff --check -- packages/hosted-execution/src/runtime-control.ts packages/hosted-execution/test/hosted-runtime-control.test.ts apps/cloudflare/src/runtime-bridge-workspace.ts apps/cloudflare/test/runtime-bridge-workspace.test.ts apps/cloudflare/test/runner-platform.test.ts apps/web/test/hosted-runtime-internal-routes.test.ts apps/web/test/hosted-workspace-store.test.ts ARCHITECTURE.md agent-docs/references/hosted-runtime-protocol.md agent-docs/exec-plans/active/2026-05-07-hosted-checkpoint-maintenance-hard-cut.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- BLOCKED: `pnpm typecheck` fails in unrelated untracked `apps/cloudflare/test/hosted-local-codex-container-continuity-e2e.test.ts` with `TS2345: Argument of type 'string' is not assignable to parameter of type 'URLSearchParams'.`

## Status

Implemented; scoped verification passed, repo typecheck blocked by unrelated active work.
Status: completed
Updated: 2026-05-07
Completed: 2026-05-07
