# Preflight finish-task path handling

Status: completed
Created: 2026-03-31
Updated: 2026-03-31

## Goal

- Make `scripts/finish-task` resilient to common scoped-commit inputs so it validates path arguments before closing the active plan and can accept directory arguments that expand to exact changed files.

## Success criteria

- `scripts/finish-task` rejects bad or ignored paths before moving the active plan.
- Directory arguments expand to exact changed files, including deleted tracked files and untracked non-ignored files.
- The helper usage/docs no longer imply file-only inputs when directory inputs are supported.
- Required verification runs, with any unrelated existing failures documented clearly.

## Scope

- In scope:
  - `scripts/finish-task`
  - Workflow docs that describe `scripts/finish-task` usage
- Out of scope:
  - Changing `scripts/committer` or `scripts/close-exec-plan.sh`
  - Broad commit-workflow redesign

## Constraints

- Keep the helper compatible with the repo's macOS shell baseline.
- Preserve the existing dirty-tree-safe commit model.
- Avoid touching unrelated gateway or onboarding work already in progress.

## Risks and mitigations

1. Risk: Directory expansion could accidentally include ignored or untouched files.
   Mitigation: Expand only changed tracked files plus untracked non-ignored files under the requested path.
2. Risk: Closing the plan can still race with commit creation if validation happens too late.
   Mitigation: Resolve and validate commit targets completely before invoking `close-exec-plan.sh`.

## Tasks

1. Add a preflight path-resolution layer to `scripts/finish-task`.
2. Update finish-task usage/help text and workflow docs to match the new accepted inputs.
3. Run required verification and document unrelated blockers if they remain red.

## Decisions

- Keep `scripts/committer` as the lower-level exact-file helper.
- Teach `scripts/finish-task` to accept file or directory inputs but still pass only exact file paths to `scripts/committer`.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Expected outcomes:
  - Green repo-required verification, or clearly documented unrelated failures outside this workflow-helper lane.
Completed: 2026-03-31
