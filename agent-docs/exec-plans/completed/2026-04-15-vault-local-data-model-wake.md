# Vault Local Data Model Wake Patch

Status: completed

## Goal

Land the returned ChatGPT patch for the local assistant automation data-model seam so operator-config reuses the canonical automation schedule and route owners.

## Success criteria

- The returned patch applies cleanly or is adapted minimally for the current repo state.
- Changes stay limited to the operator-config code/test slice plus the one supporting data-model seam doc update from the artifact.
- Required verification runs for the touched owners and any unrelated blockers are documented clearly.
- Required completion-workflow audit passes run before handoff.

## Scope

- `packages/operator-config/src/assistant-cli-contracts.ts`
- `packages/operator-config/test/assistant-cli-contracts.test.ts`
- `agent-docs/references/data-model-seams.md`
- Coordination and commit artifacts required by repo workflow

## Constraints

- Treat the returned patch as behavioral intent, not overwrite authority.
- Keep the change scoped to the downloaded artifact.
- Preserve unrelated worktree edits.
- Do not add dependency changes.

## Tasks

1. Confirm the exported thread and downloaded patch still match the current repo state.
2. Apply the narrow operator-config data-model simplification and review the resulting diff for current-state fit.
3. Run the required scoped verification for the touched owners.
4. Run required completion-workflow audit passes, then finish with a scoped commit.

## Risks and mitigations

- The patch may assume slightly older local code.
  Mitigation: adapt only what is needed for a clean behavioral match.
- The worktree already contains unrelated active edits.
  Mitigation: touch only the artifact files and commit only the exact touched paths.

## Verification

- Passed: `pnpm typecheck`
- Passed: `pnpm --dir packages/operator-config test:coverage`
- Passed: direct scenario proof via `pnpm exec tsx --eval ...` for persisted cron schedule parsing, route-less cron target parsing, and saved self-delivery route parsing
- Failed for unrelated reverse-dependent issues: `bash scripts/workspace-verify.sh test:diff packages/operator-config/src/assistant-cli-contracts.ts packages/operator-config/test/assistant-cli-contracts.test.ts agent-docs/references/data-model-seams.md`
- Completed: required completion-workflow audit passes (`coverage-write`, `task-finish-review`)
