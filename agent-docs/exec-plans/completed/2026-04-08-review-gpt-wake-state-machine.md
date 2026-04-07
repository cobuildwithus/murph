# 2026-04-08 Review-Gpt Wake State Machine

## Goal

- Fix `@cobuild/review-gpt thread wake` so completion is based on stable thread state instead of narrow fragment heuristics.
- Keep the implementation owned by `@cobuild/review-gpt`, not by Murph-local helper clones.
- Remove the unused Murph-local shadow helper files/tests once the package-owner fix is consumed.

## Scope

- `package.json`
- `pnpm-lock.yaml`
- `patches/@cobuild__review-gpt@0.5.50.patch`
- `scripts/chatgpt-attachment-files.mjs`
- `scripts/chatgpt-attachment-files.test.mjs`
- `scripts/chatgpt-managed-browser.mjs`
- `scripts/chatgpt-managed-browser.test.mjs`
- `packages/cli/test/release-script-coverage-audit.test.ts`
- `README.md`

## Constraints

- Preserve existing `pnpm review:gpt` and `pnpm chatgpt:thread:*` user-facing entrypoints.
- Keep logic ownership inside `@cobuild/review-gpt`; Murph should only carry config/wrappers and, if needed, a pinned package patch until an upstream publish happens.
- Do not publish or tag `@cobuild/review-gpt` in this turn unless the user explicitly asks.
- Preserve unrelated dirty-tree edits.

## Plan

1. Refactor the owner package in `../review-gpt` so wake completion uses stable state transitions and better terminal/no-artifact handling.
2. Verify the owner package with its required checks and focused wake tests for truncated-turn scenarios.
3. Carry the owner-package fix into Murph via a pinned dependency patch, delete the unused local shadow helper files/tests, and update consumer assertions/docs.
4. Run Murph verification for the tooling lane, complete final review, and create scoped commits.

## Verification

- Owner package (`../review-gpt`)
  - Passed: `pnpm typecheck`
  - Passed: `pnpm test`
  - Upstream owner commit: `407a3f58fdff` (`fix(thread-wake): wait for stable idle completion`)
- Murph consumer
  - Passed after `pnpm install --frozen-lockfile`: `pnpm typecheck`
  - Passed: `pnpm --dir packages/cli exec vitest run test/release-script-coverage-audit.test.ts --no-coverage`
  - Passed direct installed-package proof:
    `node --input-type=module -e "import { assistantSnapshotLooksIncomplete, snapshotBusyReason } from '@cobuild/review-gpt/dist/chatgpt-thread-lib.mjs'; ..."`
    Result: `{"incomplete":true,"reason":"assistant-settling"}`

## Notes

- The target failure mode is a watched thread that briefly looks idle on a partial assistant turn such as `I've now confirmed`, then later returns a patch artifact.
Status: completed
Updated: 2026-04-08
Completed: 2026-04-08
