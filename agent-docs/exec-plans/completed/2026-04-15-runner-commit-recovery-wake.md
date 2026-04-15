# Runner commit recovery wake patch

Status: completed

## Goal

Land the returned ChatGPT high-value bugfix patch for Cloudflare runner commit recovery without widening scope beyond the downloaded artifact.

## Success criteria

- The returned patch is applied or minimally adapted to current repo state.
- Recovered committed dispatches and bundle-only sync paths clear the correct event lease when the original run context is gone.
- Focused Cloudflare tests cover the recovered same-event lease path and the live-run preservation path.
- Required verification runs for the touched Cloudflare files and any unrelated blockers are called out clearly.
- Required completion-workflow audit passes run before handoff.

## Scope

- `apps/cloudflare/src/user-runner/runner-commit-recovery.ts`
- `apps/cloudflare/test/runner-commit-recovery.test.ts`
- Coordination and commit artifacts required by repo workflow

## Constraints

- Treat the downloaded patch as behavioral intent, not overwrite authority.
- Keep the change limited to the downloaded artifact and the minimum test scaffolding needed to prove it.
- Preserve unrelated worktree edits from other active wake tasks.
- Do not add dependency changes.

## Tasks

1. Confirm the exported thread summary and patch still match the current repo state.
2. Apply the runner commit recovery fix and focused tests, adapting only what current code requires.
3. Run the truthful Cloudflare verification lane for the touched paths.
4. Run required completion-workflow audit passes, then finish with a scoped commit.

## Risks and mitigations

- The patch may target a slightly older local test layout.
  Mitigation: adapt the test harness minimally while preserving the intended behavioral proof.
- The repo worktree is already dirty from other wake tasks.
  Mitigation: scope verification to the touched Cloudflare files and commit only the exact files from this task plus required plan artifacts.

## Verification

- Planned: `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner/runner-commit-recovery.ts apps/cloudflare/test/runner-commit-recovery.test.ts`
- Planned: required completion-workflow audit passes (`coverage-write`, `task-finish-review`)
Updated: 2026-04-15
Completed: 2026-04-15
